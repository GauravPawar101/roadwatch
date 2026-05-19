import { KafkaTopics, type ComplaintSubmittedEvent } from '@roadwatch/kafka';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { trackAnalyticsEvent } from '../analytics/service.js';
import { execute } from '../cassandra.js';
import { publishKafkaEvent } from '../kafka/publish.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { requireAuth, requireRole, type AuthedRequest } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';
import { uploadFileToPinata } from '../services/pinata.js';

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
      // projection of origin onto the segment in param space
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
      imageCid: z.string().optional(),
      imageSha256: z.string().optional()
    })
    .parse(req.body);

  if (body.capturedAt) {
    const ageMs = Date.now() - new Date(body.capturedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs > 5 * 60 * 1000) {
      return res.status(400).json({ error: 'Capture timestamp too old. Please take a fresh photo on-site.' });
    }
  }

  if (body.capturedLat != null && body.capturedLng != null) {
    const captureDistance = distanceMeters({ lat: body.lat, lng: body.lng }, { lat: body.capturedLat, lng: body.capturedLng });
    if (captureDistance > 80) {
      return res.status(400).json({ error: 'Capture location must match live location', captureDistanceM: Math.round(captureDistance) });
    }
  }

  const roadRes = await execute('SELECT id, authority_id, geometry, district_id FROM roads_catalog WHERE id = ? LIMIT 1', [body.roadId], { prepare: true });
  const roadRow = roadRes.rows[0];
  if (!roadRow) return res.status(404).json({ error: 'Road not found' });
  if (!roadRow.geometry) return res.status(400).json({ error: 'Road geometry not available for this road' });

  const distanceM = minDistanceToGeometryMeters({ lat: body.lat, lng: body.lng }, roadRow.geometry);
  if (!Number.isFinite(distanceM)) return res.status(400).json({ error: 'Invalid road geometry' });
  if (distanceM > 100) {
    return res.status(400).json({ error: 'You must be within 100m of the selected road', distanceM: Math.round(distanceM) });
  }

  let districtCode = 'UNK';
  if (roadRow.district_id) {
    const dRes = await execute('SELECT code FROM districts WHERE id = ? LIMIT 1', [roadRow.district_id], { prepare: true });
    districtCode = String(dRes.rows[0]?.code ?? 'UNK').toUpperCase();
  }
  const authorityId = String(roadRow.authority_id ?? 'UNKNOWN');

  const file = (req as any).file as Express.Multer.File | undefined;
  let attachmentCid = body.imageCid ?? null;
  let attachmentSha = body.imageSha256 ?? null;
  let attachmentProvider: 'pinata' | 'local-fallback' | 'client' = body.imageCid ? 'client' : 'local-fallback';

  if (file?.path) {
    const uploaded = await uploadFileToPinata(file.path, file.mimetype ?? 'application/octet-stream');
    attachmentCid = uploaded.cid;
    attachmentSha = uploaded.hash;
    attachmentProvider = uploaded.provider;
  }

  // Cassandra: read latest open complaint for this road (if any), then upsert in app logic.
  let complaintId: string;
  let reportCount = 1;
  let merged = false;

  // Find latest open complaint for this road (PoC uses ALLOW FILTERING)
  const existingOpen = await execute('SELECT id, report_count FROM complaints WHERE road_id = ? AND status <> ? LIMIT 1 ALLOW FILTERING', [body.roadId, 'RESOLVED'], { prepare: true });
  if (existingOpen.rows && existingOpen.rows[0]) {
    complaintId = existingOpen.rows[0].id;
    merged = true;
    await execute('UPDATE complaints SET report_count = report_count + 1, updated_at = ? WHERE id = ?', [new Date(), complaintId], { prepare: true });
    const after = await execute('SELECT report_count FROM complaints WHERE id = ? LIMIT 1', [complaintId], { prepare: true });
    reportCount = Number(after.rows[0]?.report_count ?? (existingOpen.rows[0].report_count ?? 1) + 1);
  } else {
    complaintId = `RW-${districtCode.slice(0, 3)}-${Date.now()}`;
    await execute('INSERT INTO complaints (id, district, zone, status, description, lat, lng, road_id, authority_id, report_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      complaintId,
      districtCode,
      authorityId,
      'FILED',
      body.description,
      body.lat,
      body.lng,
      body.roadId,
      authorityId,
      1,
      new Date(),
      new Date()
    ], { prepare: true });
    reportCount = 1;
  }

  if (attachmentCid && attachmentSha) {
    await execute('INSERT INTO complaint_attachments (complaint_id, kind, file_path, file_mime, file_sha256, note) VALUES (?, ?, ?, ?, ?, ?)', [
      complaintId,
      'PHOTO',
      `ipfs://${attachmentCid}`,
      file?.mimetype ?? null,
      attachmentSha,
      JSON.stringify({ cid: attachmentCid, provider: attachmentProvider, capturedAt: body.capturedAt ?? null, capturedLat: body.capturedLat ?? null, capturedLng: body.capturedLng ?? null })
    ], { prepare: true });

    await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      require('crypto').randomUUID(),
      user.sub,
      user.phoneHash,
      user.phone,
      merged ? 'COMPLAINT_MERGED_MEDIA' : 'MEDIA_PINNED',
      'complaint',
      complaintId,
      JSON.stringify({ cid: attachmentCid, sha256: attachmentSha, provider: attachmentProvider, reportCount }),
      new Date()
    ], { prepare: true });
  }

  await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    require('crypto').randomUUID(),
    user.sub,
    user.phoneHash,
    user.phone,
    merged ? 'COMPLAINT_MERGED' : 'COMPLAINT_CREATED',
    'complaint',
    complaintId,
    JSON.stringify({ district: districtCode, zone: authorityId, roadId: body.roadId, distanceM, merged, reportCount }),
    new Date()
  ], { prepare: true });

  await trackAnalyticsEvent({
    type: 'COMPLAINT_CREATED',
    actorUserId: user.sub,
    complaintId,
    district: districtCode,
    zone: authorityId,
    lat: body.lat,
    lng: body.lng,
    properties: { status: 'FILED', roadId: body.roadId, distanceM, merged, reportCount }
  });

  broadcastComplaintEvent({
    type: merged ? 'complaint_updated' : 'complaint_created',
    complaint: {
      id: complaintId,
      district: districtCode,
      zone: authorityId,
      status: 'FILED',
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
      body: merged ? `Another report on ${body.roadId} was merged into complaint ${complaintId}.` : `New complaint filed in ${districtCode} / ${authorityId}.`,
      data: { complaintId, district: districtCode, zone: authorityId, roadId: body.roadId, merged, reportCount },
      audience: { kind: 'jurisdiction', district: districtCode, zone: authorityId },
      critical: false
    }
  });

  if (!merged) {
    try {
      const event: ComplaintSubmittedEvent = {
        type: 'complaint.submitted',
        idempotencyKey: `complaint:${complaintId}:submitted`,
        occurredAt: new Date().toISOString(),
        version: 1,
        complaintId,
        district: districtCode,
        zone: authorityId,
        lat: body.lat,
        lng: body.lng,
        description: body.description
      };

      await publishKafkaEvent(KafkaTopics.complaintSubmitted, event, {
        key: complaintId,
        idempotencyKey: event.idempotencyKey
      });
    } catch (e) {
      console.error('[kafka] complaint.submitted publish failed', e);
    }
  }

  res.json({ ok: true, merged, complaint: { id: complaintId, cid: attachmentCid, sha256: attachmentSha, reportCount } });
});

router.post('/media/pinata', requireAuth, requireRole(['CITIZEN']), upload.single('image'), async (req, res) => {
  const body = z
    .object({
      capturedLat: z.coerce.number(),
      capturedLng: z.coerce.number(),
      capturedAt: z.string().datetime()
    })
    .parse(req.body);

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file?.path) return res.status(400).json({ error: 'image file is required' });

  const ageMs = Date.now() - new Date(body.capturedAt).getTime();
  if (Number.isFinite(ageMs) && ageMs > 5 * 60 * 1000) {
    return res.status(400).json({ error: 'Capture timestamp too old. Please capture again.' });
  }

  const uploaded = await uploadFileToPinata(file.path, file.mimetype ?? 'application/octet-stream');
  res.json({ ok: true, cid: uploaded.cid, sha256: uploaded.hash, provider: uploaded.provider, url: uploaded.url });
});

export default router;
