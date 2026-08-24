import { KafkaTopics, type ComplaintSubmittedEvent } from '@roadwatch/kafka';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { trackAnalyticsEvent } from '../analytics/service.js';
import { buildRequestHash, claimIdempotency, deriveIdempotencyKey, storeIdempotencyResult } from '../idempotency.js';
import { enqueueKafkaEvent } from '../kafka/outbox.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { pool, sql } from '../postgres.js';
import { requireAuth, requireRole, type AuthedRequest } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';
import { uploadFileToSupabaseStorage } from '../services/supabase-storage.js';
import {
  awardDuplicateImagePenalty,
  awardValidSubmissionKarma,
  ensureSlaTracking,
  findDuplicateGeotaggedImage,
} from '../services/complaint-lifecycle.js';
import { uuidv7 } from '../uuid.js';

const router = express.Router();

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'complaints');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

// Multer storage: keep files on local disk (dev-friendly). In production, swap for object storage.
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureDir(UPLOAD_ROOT);
      cb(null, UPLOAD_ROOT);
    } catch (e) {
      cb(e as Error, UPLOAD_ROOT);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${crypto.randomUUID()}${ext || ''}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

function toRad(v: number) {
  return (v * Math.PI) / 180;
}

function distancePointToSegmentMeters(point: { lat: number; lng: number }, segment: Array<[number, number]>): number {
  // segment coordinates are [lng, lat]
  const R = 6371000;
  const lat0 = toRad(point.lat);
  const cos0 = Math.cos(lat0);

  const xy = (coord: [number, number]) => {
    const [lng, lat] = coord;
    return {
      x: toRad(lng - point.lng) * R * cos0,
      y: toRad(lat - point.lat) * R
    };
  };

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < segment.length - 1; i++) {
    const a = xy(segment[i]!);
    const b = xy(segment[i + 1]!);

    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;

    let t = 0;
    if (len2 > 0) {
      t = (-(a.x * vx + a.y * vy)) / len2;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
    }

    const cx = a.x + t * vx;
    const cy = a.y + t * vy;
    const d = Math.sqrt(cx * cx + cy * cy);
    if (d < best) best = d;
  }

  return best;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Live captures: 5 min. Offline-queued sync: 7 days (low-network areas). */
function validateCaptureTimestamp(capturedAt: string, offlineQueued?: boolean): string | null {
  const ageMs = Date.now() - new Date(capturedAt).getTime();
  const maxAgeMs = offlineQueued ? 7 * 24 * 60 * 60 * 1000 : 5 * 60 * 1000;
  if (!Number.isFinite(ageMs)) return 'Invalid capture timestamp';
  if (ageMs < 0) return 'Capture timestamp cannot be in the future';
  if (ageMs > maxAgeMs) {
    return offlineQueued
      ? 'Offline capture too old (max 7 days). Please retake the photo on-site.'
      : 'Capture timestamp too old. Please take a fresh photo on-site.';
  }
  return null;
}

function minDistanceToGeometryMeters(point: { lat: number; lng: number }, geometry: any): number {
  if (!geometry || typeof geometry !== 'object') return Number.POSITIVE_INFINITY;

  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return distancePointToSegmentMeters(point, geometry.coordinates as Array<[number, number]>);
  }

  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    let best = Number.POSITIVE_INFINITY;
    for (const line of geometry.coordinates as Array<Array<[number, number]>>) {
      const d = distancePointToSegmentMeters(point, line);
      if (d < best) best = d;
    }
    return best;
  }

  return Number.POSITIVE_INFINITY;
}

router.post('/complaints', requireAuth, requireRole(['CITIZEN']), upload.single('image'), async (req, res) => {
  const user = (req as AuthedRequest).user;

  const body = z
    .object({
      roadId: z.string().min(1),
      description: z.string().min(5),
      lat: z.coerce.number(),
      lng: z.coerce.number(),
      capturedLat: z.coerce.number().optional(),
      capturedLng: z.coerce.number().optional(),
      capturedAt: z.string().datetime().optional(),
      offlineQueued: z.coerce.boolean().optional(),
      imageCid: z.string().optional(),
      imageSha256: z.string().optional()
    })
    .parse(req.body);

  if (body.capturedAt) {
    const tsError = validateCaptureTimestamp(body.capturedAt, body.offlineQueued);
    if (tsError) return res.status(400).json({ error: tsError });
  }

  if (body.capturedLat != null && body.capturedLng != null) {
    const captureDistance = distanceMeters(
      { lat: body.lat, lng: body.lng },
      { lat: body.capturedLat, lng: body.capturedLng }
    );
    if (captureDistance > 80) {
      return res.status(400).json({
        error: 'Capture location must match live location',
        captureDistanceM: Math.round(captureDistance)
      });
    }
  }

  const roadRes = await pool.query(
    `SELECT id, authority_id, geometry, district_id FROM roads_catalog WHERE id = $1 LIMIT 1`,
    [body.roadId]
  );
  const roadRow = roadRes.rows[0];
  if (!roadRow) return res.status(404).json({ error: 'Road not found' });
  if (!roadRow.geometry) return res.status(400).json({ error: 'Road geometry not available for this road' });

  const distanceM = minDistanceToGeometryMeters({ lat: body.lat, lng: body.lng }, roadRow.geometry);
  if (!Number.isFinite(distanceM)) return res.status(400).json({ error: 'Invalid road geometry' });
  if (distanceM > 100) {
    return res.status(400).json({
      error: 'You must be within 100m of the selected road',
      distanceM: Math.round(distanceM)
    });
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  const idempotencyPayload = {
    actor: user.sub,
    roadId: body.roadId,
    description: body.description,
    lat: body.lat,
    lng: body.lng,
    capturedLat: body.capturedLat ?? null,
    capturedLng: body.capturedLng ?? null,
    capturedAt: body.capturedAt ?? null,
    imageCid: body.imageCid ?? null,
    imageSha256: body.imageSha256 ?? null,
    file: file
      ? {
          originalName: file.originalname,
          mime: file.mimetype,
          size: file.size
        }
      : null
  };

  const idempotencyKey = deriveIdempotencyKey(req, 'citizen:complaints:create');
  const requestHash = buildRequestHash(idempotencyPayload);
  const claimed = await claimIdempotency('citizen:complaints:create', idempotencyKey, requestHash);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  let districtCode = 'UNK';
  if (roadRow.district_id) {
    const dRes = await pool.query(
      `SELECT code FROM districts WHERE id = $1 LIMIT 1`,
      [roadRow.district_id]
    );
    districtCode = String(dRes.rows[0]?.code ?? 'UNK').toUpperCase();
  }
  const authorityId = String(roadRow.authority_id ?? 'UNKNOWN');

  let attachmentCid = body.imageCid ?? null;
  let attachmentSha = body.imageSha256 ?? null;
  let attachmentProvider: 'supabase-storage' | 'local-fallback' | 'client' = body.imageCid ? 'client' : 'local-fallback';

  if (file?.path) {
    const uploaded = await uploadFileToSupabaseStorage(file.path, file.mimetype ?? 'application/octet-stream');
    attachmentCid = uploaded.cid;
    attachmentSha = uploaded.hash;
    attachmentProvider = uploaded.provider;
  }

  // Use a transaction + SELECT FOR UPDATE to safely merge or create the complaint atomically.
  let complaintId = '';
  let reportCount = 1;
  let merged = false;
  const complaintStatus = 'Open';

  await sql.begin(async (tx: any) => {
    const existingOpen = await tx`
      SELECT id, report_count
      FROM complaints
      WHERE road_id = ${body.roadId}
        AND UPPER(status) <> 'RESOLVED'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `;

    if (existingOpen[0]) {
      complaintId = String(existingOpen[0].id);
      merged = true;
      const updated = await tx`
        UPDATE complaints
        SET report_count = report_count + 1,
            updated_at   = NOW()
        WHERE id = ${complaintId}
        RETURNING report_count
      `;
      reportCount = Number(updated[0]?.report_count ?? 2);
    } else {
      complaintId = uuidv7();
      await tx`
        INSERT INTO complaints
           (id, district, zone, status, description, lat, lng, road_id, authority_id, user_id, report_count, created_at, updated_at)
         VALUES (${complaintId}, ${districtCode}, ${authorityId}, 'FILED', ${body.description}, ${body.lat}, ${body.lng}, ${body.roadId}, ${authorityId}, ${user.sub}, 1, NOW(), NOW())
      `;
      reportCount = 1;
    }

    if (!merged) {
      const event: ComplaintSubmittedEvent = {
        type: 'complaint-submitted',
        idempotencyKey: `complaint:${complaintId}:submitted`,
        occurredAt: new Date().toISOString(),
        version: 1,
        complaintId,
        district: districtCode,
        zone: authorityId,
        lat: body.lat ?? undefined,
        lng: body.lng ?? undefined,
        description: body.description,
        roadId: body.roadId,
        authorityOrg: authorityId,
        citizenId: user.sub,
        initialIPFSCid: attachmentCid ?? undefined,
        detailsHash: attachmentSha ?? undefined,
        location: { lat: body.lat, lng: body.lng, capturedAt: body.capturedAt ?? null },
        merged,
        reportCount
      };

      await enqueueKafkaEvent(tx, KafkaTopics.complaintSubmitted, event, {
        key: complaintId,
        idempotencyKey: event.idempotencyKey
      });
    }
  });

  if (attachmentCid && attachmentSha) {
    const dupComplaintId = await findDuplicateGeotaggedImage(attachmentSha);
    if (dupComplaintId && dupComplaintId !== complaintId) {
      await awardDuplicateImagePenalty(user.sub, attachmentSha).catch(() => null);
      await storeIdempotencyResult(claimed, 409, {
        error: 'Duplicate geotagged image',
        existingComplaintId: dupComplaintId,
      });
      return res.status(409).json({
        error: 'Duplicate geotagged image',
        existingComplaintId: dupComplaintId,
      });
    }

    await pool.query(
      `INSERT INTO complaint_attachments
         (complaint_id, kind, file_path, file_mime, file_sha256, note)
       VALUES ($1, 'PHOTO', $2, $3, $4, $5)`,
      [
        complaintId,
        `ipfs://${attachmentCid}`,
        file?.mimetype ?? null,
        attachmentSha,
        {
          cid: attachmentCid,
          provider: attachmentProvider,
          capturedAt: body.capturedAt ?? null,
          capturedLat: body.capturedLat ?? null,
          capturedLng: body.capturedLng ?? null
        }
      ]
    );

    await pool.query(
      `INSERT INTO audit_log
         (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
      VALUES (${uuidv7()}, $1, $2, $3, $4, 'complaint', $5, $6, NOW())`,
      [
        user.sub,
        user.phoneHash,
        user.phone,
        merged ? 'COMPLAINT_MERGED_MEDIA' : 'MEDIA_PINNED',
        complaintId,
        {
          cid: attachmentCid,
          sha256: attachmentSha,
          provider: attachmentProvider,
          reportCount
        }
      ]
    );
  }

  if (!merged) {
    await ensureSlaTracking(complaintId, { severity: 3, roadType: body.roadId });
  }
  await awardValidSubmissionKarma(user.sub, complaintId).catch(() => null);

  await pool.query(
    `INSERT INTO audit_log
       (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
    VALUES (${uuidv7()}, $1, $2, $3, $4, 'complaint', $5, $6, NOW())`,
    [
      user.sub,
      user.phoneHash,
      user.phone,
      merged ? 'COMPLAINT_MERGED' : 'COMPLAINT_CREATED',
      complaintId,
      {
        district: districtCode,
        zone: authorityId,
        roadId: body.roadId,
        distanceM,
        merged,
        reportCount
      }
    ]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_CREATED',
    actorUserId: user.sub,
    complaintId,
    district: districtCode,
    zone: authorityId,
    lat: body.lat,
    lng: body.lng,
    properties: { status: complaintStatus, roadId: body.roadId, distanceM, merged, reportCount }
  });

  broadcastComplaintEvent({
    type: merged ? 'complaint_updated' : 'complaint_created',
    complaint: {
      id: complaintId,
      district: districtCode,
      zone: authorityId,
      status: complaintStatus,
      description: body.description,
      lat: body.lat,
      lng: body.lng,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'new_complaint',
      title: merged ? `Complaint merged into ${complaintId}` : `New complaint ${complaintId}`,
      body: merged
        ? `Another report on ${body.roadId} was merged into complaint ${complaintId}.`
        : `New complaint filed in ${districtCode} / ${authorityId}.`,
      data: { complaintId, district: districtCode, zone: authorityId, roadId: body.roadId, merged, reportCount },
      audience: { kind: 'jurisdiction', district: districtCode, zone: authorityId },
      critical: false
    }
  });

  const responseBody = {
    ok: true,
    merged,
    complaint: { id: complaintId, status: complaintStatus, cid: attachmentCid, sha256: attachmentSha, reportCount }
  };

  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.post('/media/upload', requireAuth, requireRole(['CITIZEN']), upload.single('image'), async (req, res) => {
  const user = (req as AuthedRequest).user;
  const body = z
    .object({
      capturedLat: z.coerce.number(),
      capturedLng: z.coerce.number(),
      capturedAt: z.string().datetime(),
      offlineQueued: z.coerce.boolean().optional()
    })
    .parse(req.body);

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file?.path) return res.status(400).json({ error: 'image file is required' });

  const tsError = validateCaptureTimestamp(body.capturedAt, body.offlineQueued);
  if (tsError) return res.status(400).json({ error: tsError });

  const fileBuf = await fs.readFile(file.path);
  const shaPreview = crypto.createHash('sha256').update(fileBuf).digest('hex');

  const idempotencyPayload = {
    actor: user.sub,
    sha256: shaPreview,
    capturedLat: body.capturedLat,
    capturedLng: body.capturedLng,
    capturedAt: body.capturedAt,
    size: file.size,
    mime: file.mimetype,
  };
  const idempotencyKey = deriveIdempotencyKey(req, 'citizen:media:upload');
  const requestHash = buildRequestHash(idempotencyPayload);
  const claimed = await claimIdempotency('citizen:media:upload', idempotencyKey, requestHash);
  if ('replay' in claimed) {
    return res.status(claimed.statusCode).json(claimed.body as any);
  }

  const dupComplaintId = await findDuplicateGeotaggedImage(shaPreview);
  if (dupComplaintId) {
    await awardDuplicateImagePenalty(user.sub, shaPreview).catch(() => null);
    const conflict = {
      error: 'Duplicate geotagged image already attached to a complaint',
      existingComplaintId: dupComplaintId,
      sha256: shaPreview,
    };
    await storeIdempotencyResult(claimed, 409, conflict);
    return res.status(409).json(conflict);
  }

  const uploaded = await uploadFileToSupabaseStorage(file.path, file.mimetype ?? 'application/octet-stream');
  const responseBody = {
    ok: true,
    cid: uploaded.cid,
    sha256: uploaded.hash || shaPreview,
    provider: uploaded.provider,
    url: uploaded.url,
    geotag: { lat: body.capturedLat, lng: body.capturedLng, capturedAt: body.capturedAt },
  };
  await storeIdempotencyResult(claimed, 200, responseBody);
  res.json(responseBody);
});

router.post('/complaints/:id/confirm', requireAuth, requireRole(['CITIZEN']), async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ note: z.string().max(1000).optional() }).parse(req.body);

  const complaintRes = await pool.query(
    `SELECT id, district, zone, status, metadata, description, lat, lng FROM complaints WHERE id = $1 LIMIT 1`,
    [params.id]
  );
  const complaint = complaintRes.rows[0];
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (complaint.metadata?.authorId && complaint.metadata.authorId !== user.sub) {
    return res.status(403).json({ error: 'Only the reporting citizen can confirm this complaint' });
  }

  await pool.query(
    `UPDATE complaints SET status = 'CITIZEN_CONFIRMED', updated_at = NOW() WHERE id = $1`,
    [params.id]
  );
  await pool.query(
    `INSERT INTO complaint_reviews (id, complaint_id, user_id, user_role, decision, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [uuidv7(), params.id, user.sub, user.role, 'CONFIRMED', body.note ?? null]
  );
  await pool.query(
    `UPDATE complaint_assignments SET reviewed_at = NOW(), review_decision = 'CONFIRMED', review_note = $2 WHERE complaint_id = $1`,
    [params.id, body.note ?? null]
  ).catch(() => null);

  await trackAnalyticsEvent({
    type: 'COMPLAINT_STATUS_CHANGED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { note: body.note ?? null }
  });

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: complaint.id,
      district: complaint.district,
      zone: complaint.zone,
      status: 'CITIZEN_CONFIRMED',
      description: complaint.description,
      lat: complaint.lat,
      lng: complaint.lng,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'status_change',
      title: `Complaint ${params.id} confirmed`,
      body: body.note ?? 'The reporting citizen confirmed the repair.',
      data: { complaintId: params.id, decision: 'CONFIRMED', note: body.note ?? null },
      audience: { kind: 'jurisdiction', district: complaint.district, zone: complaint.zone },
      critical: false
    }
  });

  res.json({ ok: true, status: 'CITIZEN_CONFIRMED' });
});

router.post('/complaints/:id/dispute', requireAuth, requireRole(['CITIZEN']), async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ note: z.string().max(1000).optional() }).parse(req.body);

  const complaintRes = await pool.query(
    `SELECT id, district, zone, status, metadata, description, lat, lng FROM complaints WHERE id = $1 LIMIT 1`,
    [params.id]
  );
  const complaint = complaintRes.rows[0];
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (complaint.metadata?.authorId && complaint.metadata.authorId !== user.sub) {
    return res.status(403).json({ error: 'Only the reporting citizen can dispute this complaint' });
  }

  await pool.query(
    `UPDATE complaints SET status = 'CITIZEN_DISPUTED', updated_at = NOW() WHERE id = $1`,
    [params.id]
  );
  await pool.query(
    `INSERT INTO complaint_reviews (id, complaint_id, user_id, user_role, decision, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [uuidv7(), params.id, user.sub, user.role, 'DISPUTED', body.note ?? null]
  );
  await pool.query(
    `UPDATE complaint_assignments SET reviewed_at = NOW(), review_decision = 'DISPUTED', review_note = $2 WHERE complaint_id = $1`,
    [params.id, body.note ?? null]
  ).catch(() => null);

  await trackAnalyticsEvent({
    type: 'COMPLAINT_STATUS_CHANGED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { note: body.note ?? null }
  });

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: complaint.id,
      district: complaint.district,
      zone: complaint.zone,
      status: 'CITIZEN_DISPUTED',
      description: complaint.description,
      lat: complaint.lat,
      lng: complaint.lng,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'status_change',
      title: `Complaint ${params.id} disputed`,
      body: body.note ?? 'The reporting citizen disputed the repair outcome.',
      data: { complaintId: params.id, decision: 'DISPUTED', note: body.note ?? null },
      audience: { kind: 'jurisdiction', district: complaint.district, zone: complaint.zone },
      critical: true
    }
  });

  res.json({ ok: true, status: 'CITIZEN_DISPUTED' });
});

export default router;