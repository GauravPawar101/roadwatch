import express from 'express';
import { z } from 'zod';
import { pool } from '../../../apps/gateway-api/src/postgres.js';
import { analyzeComplaintText } from '../../../packages/core/src/engines/complaintTextIntel.ts';
import { ensureAuthenticated } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { enqueueComplaintSubmittedEvent } from '../services/complaintOutbox.js';
import { emitComplaintEvent } from '../services/kafka.js';

const router = express.Router();

const complaintSchema = z.object({
  roadId: z.string().min(1),
  description: z.string().min(1).optional(),
  damageType: z.string().min(1),
  severity: z.coerce.number().int().min(1).max(5),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  capturedLat: z.coerce.number().optional(),
  capturedLng: z.coerce.number().optional(),
  capturedAt: z.string().datetime().optional(),
  imageCid: z.string().min(1).optional(),
  imageSha256: z.string().min(1).optional(),
  imageMime: z.string().min(1).optional()
});

const webhookSchema = z.object({
  complaintId: z.string().min(1),
  eventType: z.enum(['complaint-submitted', 'complaint-anchored', 'complaint-status-changed']).optional(),
  type: z.enum(['complaint-submitted', 'complaint-anchored', 'complaint-status-changed']).optional(),
  fabricTxId: z.string().min(1).optional(),
  txHash: z.string().min(1).optional(),
  newStatus: z.string().min(1).optional(),
  previousStatus: z.string().min(1).optional(),
  district: z.string().min(1).optional(),
  zone: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  reportCount: z.coerce.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.string().datetime().optional()
});

type JwtPayload = {
  sub?: string;
  userId?: string;
  roles?: string[];
};

function toRad(v: number) {
  return (v * Math.PI) / 180;
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

function distancePointToSegmentMeters(point: { lat: number; lng: number }, segment: Array<[number, number]>): number {
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

function minDistanceToGeometryMeters(point: { lat: number; lng: number }, geometry: any): number {
  if (!geometry || typeof geometry !== 'object') return Number.POSITIVE_INFINITY;

  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return distancePointToSegmentMeters(point, geometry.coordinates as Array<[number, number]>);
  }

  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    let best = Number.POSITIVE_INFINITY;
    for (const line of geometry.coordinates as Array<Array<[number, number]>>) {
      const distance = distancePointToSegmentMeters(point, line);
      if (distance < best) best = distance;
    }
    return best;
  }

  return Number.POSITIVE_INFINITY;
}

function isUuidLike(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function getActorId(req: express.Request): string | null {
  const payload = (req as express.Request & { jwtPayload?: JwtPayload }).jwtPayload;
  const userId = payload?.sub ?? payload?.userId ?? null;
  return userId && userId.trim() ? userId : null;
}

type ComplaintMergeCandidate = {
  id: string;
  status: string;
  report_count: number;
  created_at: Date | string;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
};

function getComplaintSeverity(metadata: Record<string, unknown> | null, fallback: number): number {
  const raw = metadata?.severity;
  const value = typeof raw === 'number' ? raw : Number(raw ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function toComplaintMetadata(metadata: Record<string, unknown> | null, updates: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    ...updates
  };
}

const MERGE_ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// POST /complaints - File a new complaint or merge into an existing same-road/same-type complaint
router.post('/', ensureAuthenticated, rateLimiter, async (req, res) => {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: 'Missing authenticated user id' });
    }

    const body = complaintSchema.parse(req.body);

    if (body.capturedAt) {
      const ageMs = Date.now() - new Date(body.capturedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > 5 * 60 * 1000) {
        return res.status(400).json({ error: 'Capture timestamp too old. Please take a fresh photo on-site.' });
      }
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
      `SELECT id, authority_id, geometry, district_id, name, metadata
       FROM roads_catalog
       WHERE id = $1
       LIMIT 1`,
      [body.roadId]
    );
    const roadRow = roadRes.rows[0];
    if (!roadRow) {
      return res.status(404).json({ error: 'Road not found' });
    }
    if (!roadRow.geometry) {
      return res.status(400).json({ error: 'Road geometry not available for this road' });
    }

    const distanceM = minDistanceToGeometryMeters({ lat: body.lat, lng: body.lng }, roadRow.geometry);
    if (!Number.isFinite(distanceM)) {
      return res.status(400).json({ error: 'Invalid road geometry' });
    }
    if (distanceM > 100) {
      return res.status(400).json({
        error: 'You must be within 100m of the selected road',
        distanceM: Math.round(distanceM)
      });
    }

    const districtCode = String(roadRow.district_id ?? 'UNK').toUpperCase();
    const authorityId = String(roadRow.authority_id ?? 'UNKNOWN');

    const attachmentCid = body.imageCid ?? null;
    const attachmentSha = body.imageSha256 ?? null;
    const attachmentMime = body.imageMime ?? null;
    const shouldAttach = Boolean(attachmentCid && attachmentSha);
    const damageType = body.damageType ?? 'General';
    const severity = body.severity ?? 3;
    const complaintDescription = body.description?.trim() || `Citizen report: ${damageType}`;
    const textIntel = analyzeComplaintText(body.description ?? null);
    const inferredSeverity = textIntel.recommendedSeverity > 0 ? Math.max(severity, textIntel.recommendedSeverity) : severity;

    let complaintId = '';
    let merged = false;
    let escalated = false;
    let reassigned = false;
    let reportCount = 1;
    let finalStatus = 'FILED';
    let finalSeverity = severity;
    let mergeReason: string | null = null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const activeRes = await client.query(
        `SELECT id, status, report_count, created_at, updated_at, metadata
         FROM complaints
         WHERE road_id = $1
           AND metadata->>'damageType' = $2
           AND status IN ('FILED', 'IN_PROGRESS', 'ESCALATED')
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [body.roadId, damageType]
      );

      let existing: ComplaintMergeCandidate | undefined = activeRes.rows[0];

      if (!existing) {
        const resolvedRes = await client.query(
          `SELECT id, status, report_count, created_at, updated_at, metadata
           FROM complaints
           WHERE road_id = $1
             AND metadata->>'damageType' = $2
             AND status = 'RESOLVED'
             AND updated_at >= NOW() - INTERVAL '24 hours'
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 1
           FOR UPDATE`,
          [body.roadId, damageType]
        );
        existing = resolvedRes.rows[0];
      }

      if (existing) {
        complaintId = String(existing.id);
        merged = true;
        reportCount = Number(existing.report_count ?? 1) + 1;

        const isResolvedRecurrence = existing.status === 'RESOLVED';
        const ageMs = isResolvedRecurrence
          ? Date.now() - new Date(existing.updated_at).getTime()
          : Date.now() - new Date(existing.created_at).getTime();
        const shouldEscalate = isResolvedRecurrence
          ? ageMs <= MERGE_ESCALATION_WINDOW_MS
          : ageMs >= MERGE_ESCALATION_WINDOW_MS;

        finalSeverity = Math.max(getComplaintSeverity(existing.metadata, severity), inferredSeverity);
        if (shouldEscalate) {
          escalated = true;
          finalSeverity = Math.min(finalSeverity + (isResolvedRecurrence ? 2 : 1), 5);
          finalStatus = 'ESCALATED';
          mergeReason = isResolvedRecurrence ? 'resolved-within-24h' : 'active-over-24h';
        } else {
          finalStatus = existing.status;
          mergeReason = 'same-road-same-type-merge';
        }

        const updatedMetadata = toComplaintMetadata(existing.metadata, {
          damageType,
          severity: finalSeverity,
          mergedAt: new Date().toISOString(),
          escalationReason: mergeReason,
          escalationLevel: escalated ? (isResolvedRecurrence ? 2 : 1) : Number(existing.metadata?.escalationLevel ?? 0),
          escalatedAt: escalated ? new Date().toISOString() : existing.metadata?.escalatedAt ?? null,
          textIntel: {
            ...textIntel,
            severityDelta: Math.max(0, Math.min(5, finalSeverity - severity))
          }
        });

        const updated = await client.query(
          `UPDATE complaints
           SET report_count = report_count + 1,
               status       = $2,
               updated_at   = NOW()
               , metadata    = $3
           WHERE id = $1
           RETURNING report_count`,
          [complaintId, finalStatus, updatedMetadata]
        );
        reportCount = Number(updated.rows[0]?.report_count ?? 2);

        if (escalated) {
          const roadAssignmentRes = await client.query(
            `SELECT contractor_id, engineer_user_id
             FROM road_assignments
             WHERE road_id = $1
             ORDER BY assigned_at DESC
             LIMIT 1`,
            [body.roadId]
          );
          const roadAssignment = roadAssignmentRes.rows[0] as { contractor_id?: string | null; engineer_user_id?: string | null } | undefined;

          if (roadAssignment?.contractor_id) {
            await client.query(
              `INSERT INTO complaint_assignments
                 (complaint_id, contractor_id, expected_resolution_days, assigned_by_user_id, assigned_at, notes)
               VALUES ($1, $2, $3, $4, NOW(), $5)
               ON CONFLICT (complaint_id) DO UPDATE
                 SET contractor_id = EXCLUDED.contractor_id,
                     expected_resolution_days = EXCLUDED.expected_resolution_days,
                     assigned_by_user_id = EXCLUDED.assigned_by_user_id,
                     assigned_at = NOW(),
                     notes = EXCLUDED.notes`,
              [complaintId, roadAssignment.contractor_id, 1, null, 'auto-reassigned after recurrence escalation']
            );
            reassigned = true;
          }

          if (roadAssignment?.engineer_user_id) {
            await client.query(
              `INSERT INTO audit_log
                 (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
               VALUES (gen_random_uuid(), $1, NULL, NULL, $2, 'complaint', $3, $4, NOW())`,
              [
                roadAssignment.engineer_user_id,
                'SLA_WARNING',
                complaintId,
                {
                  roadId: body.roadId,
                  damageType,
                  escalationReason: mergeReason,
                  severity: finalSeverity
                }
              ]
            );
          }
        }
      } else {
        complaintId = `RW-${String(districtCode).slice(0, 3)}-${Date.now()}`;
        reportCount = 1;
        finalStatus = 'FILED';
        finalSeverity = inferredSeverity;
        await client.query(
          `INSERT INTO complaints
             (id, district, zone, status, description, lat, lng, road_id, authority_id, report_count, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, 'FILED', $4, $5, $6, $7, $8, 1, $9, NOW(), NOW())`,
          [
            complaintId,
            districtCode,
            authorityId,
            complaintDescription,
            body.lat,
            body.lng,
            body.roadId,
            authorityId,
            {
              roadId: body.roadId,
              damageType,
              severity: finalSeverity,
              authorId: actorId,
              capturedLat: body.capturedLat ?? null,
              capturedLng: body.capturedLng ?? null,
              capturedAt: body.capturedAt ?? null,
              public: true,
              textIntel
            }
          ]
        );
      }

        if (escalated) {
        await emitComplaintEvent(
          {
            type: 'complaint-status-changed',
            idempotencyKey: `complaint:${complaintId}:status:${finalStatus}`,
            occurredAt: new Date().toISOString(),
            version: 1,
            complaintId,
            previousStatus: existing ? existing.status : 'FILED',
            newStatus: finalStatus,
            district: districtCode,
            zone: authorityId,
            metadata: {
              roadId: body.roadId,
              damageType,
              severity: finalSeverity,
              mergeReason,
              reassigned
            }
          },
          'complaint-status-changed',
          { key: complaintId }
        );
      }

      if (!merged) {
        await enqueueComplaintSubmittedEvent(client, {
          type: 'complaint-submitted',
          idempotencyKey: `complaint:${complaintId}:submitted`,
          occurredAt: new Date().toISOString(),
          version: 1,
          complaintId,
          district: districtCode,
          zone: authorityId,
          lat: body.lat,
          lng: body.lng,
          description: complaintDescription
        });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (shouldAttach) {
      await pool.query(
        `INSERT INTO complaint_attachments
           (complaint_id, kind, file_path, file_mime, file_sha256, note, created_at)
         VALUES ($1, 'PHOTO', $2, $3, $4, $5, NOW())`,
        [
          complaintId,
          `ipfs://${attachmentCid}`,
          attachmentMime,
          attachmentSha,
          {
            cid: attachmentCid,
            mime: attachmentMime,
            capturedAt: body.capturedAt ?? null,
            capturedLat: body.capturedLat ?? null,
            capturedLng: body.capturedLng ?? null
          }
        ]
      );
    }

    await pool.query(
      `INSERT INTO audit_log
         (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at)
       VALUES (gen_random_uuid(), $1, NULL, NULL, $2, 'complaint', $3, $4, NOW())`,
      [
        isUuidLike(actorId) ? actorId : null,
        escalated ? 'COMPLAINT_ESCALATED' : merged ? 'COMPLAINT_MERGED' : 'COMPLAINT_CREATED',
        complaintId,
        {
          district: districtCode,
          zone: authorityId,
          roadId: body.roadId,
          damageType,
          distanceM,
          merged,
          escalated,
          reassigned,
          mergeReason,
          reportCount,
          severity: finalSeverity,
          textIntel,
          attachmentCid,
          attachmentSha
        }
      ]
    );

    return res.status(201).json({
      ok: true,
      merged,
      escalated,
      reassigned,
      complaint: {
        id: complaintId,
        district: districtCode,
        zone: authorityId,
        roadId: body.roadId,
        reportCount,
        status: finalStatus,
        severity: finalSeverity,
        damageType,
        description: complaintDescription,
        textIntel,
        lat: body.lat,
        lng: body.lng,
        attachmentCid,
        attachmentSha,
        distanceM: Math.round(distanceM)
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid complaint payload', details: error.flatten() });
    }

    console.error('Error creating complaint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /complaints/:id - Get complaint by ID
router.get('/:id', ensureAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;

    const complaintRes = await pool.query(
      `SELECT id, district, zone, status, description, lat, lng, road_id, authority_id,
              report_count, created_at, updated_at, fabric_txid, anchored_at, anchored_tx_hash
       FROM complaints
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    const complaint = complaintRes.rows[0];
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const roadRes = await pool.query(
      `SELECT name, road_type FROM roads_catalog WHERE id = $1 LIMIT 1`,
      [complaint.road_id]
    );

    const attachmentsRes = await pool.query(
      `SELECT id, kind, file_path, file_mime, file_sha256, note, created_at
       FROM complaint_attachments
       WHERE complaint_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    // Determine requester privileges: authority/admin can see full attachments
    const requesterId = (req as any).userId || null;
    const requesterRoles: string[] = (req as any).user?.roles ?? [];
    const isPrivileged = requesterRoles.includes('admin') || requesterRoles.includes('authority');

    let attachments = attachmentsRes.rows;
    if (!isPrivileged) {
      // If not privileged, only allow attachment visibility if requester is the author recorded in metadata
      const authorId = complaint.metadata?.authorId ?? complaint.metadata?.author_id ?? null;
      if (!authorId || String(authorId) !== String(requesterId)) {
        attachments = [];
      }
    }

    return res.json({
      complaint: {
        ...complaint,
        road_name: roadRes.rows[0]?.name ?? null,
        road_type: roadRes.rows[0]?.road_type ?? null,
        attachments
      }
    });
  } catch (error) {
    console.error('Error fetching complaint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;