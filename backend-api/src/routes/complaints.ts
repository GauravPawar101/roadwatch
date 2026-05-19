import express from 'express';
import { z } from 'zod';
import { execute } from '../../../apps/gateway-api/src/cassandra.js';
import { validateJWT } from '../middleware/jwt';
import { rateLimiter } from '../middleware/rateLimiter';
import { emitComplaintEvent } from '../services/kafka.js';

const router = express.Router();

const complaintSchema = z.object({
  roadId: z.string().min(1),
  description: z.string().min(5),
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
  eventType: z.enum(['complaint.submitted', 'complaint.anchored', 'complaint.status.changed']).optional(),
  type: z.enum(['complaint.submitted', 'complaint.anchored', 'complaint.status.changed']).optional(),
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

// POST /complaints - File a new complaint or merge into an existing open complaint on the same road
router.post('/', validateJWT, rateLimiter, async (req, res) => {
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
      const captureDistance = distanceMeters({ lat: body.lat, lng: body.lng }, { lat: body.capturedLat, lng: body.capturedLng });
      if (captureDistance > 80) {
        return res.status(400).json({ error: 'Capture location must match live location', captureDistanceM: Math.round(captureDistance) });
      }
    }

    const roadRes = await execute('SELECT id, authority_id, geometry, district_id, name, metadata FROM roads_catalog WHERE id = ?', [body.roadId], { prepare: true });
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
      return res.status(400).json({ error: 'You must be within 100m of the selected road', distanceM: Math.round(distanceM) });
    }

    // district/authority mapping in Cassandra: roads_catalog stores district_id and authority_id in metadata or columns
    const districtCode = String((roadRow.district_id ?? 'UNK')).toUpperCase();
    const authorityId = String(roadRow.authority_id ?? 'UNKNOWN');

    const attachmentCid = body.imageCid ?? null;
    const attachmentSha = body.imageSha256 ?? null;
    const attachmentMime = body.imageMime ?? null;
    const shouldAttach = Boolean(attachmentCid && attachmentSha);

    // Cassandra-based flow (no transactions). Find any open complaint on this road.
    let complaintId = '';
    let merged = false;
    let reportCount = 1;

    const existingRes = await execute('SELECT id, report_count, status, updated_at, created_at FROM complaints WHERE road_id = ? ALLOW FILTERING', [body.roadId], { prepare: true });
    // Pick latest non-resolved complaint if any
    const open = (existingRes.rows || []).filter((r: any) => r.status !== 'RESOLVED').sort((a: any, b: any) => {
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    })[0];

    if (open) {
      complaintId = open.id;
      merged = true;
      reportCount = Number((open.report_count ?? 0) + 1);
      await execute('UPDATE complaints SET report_count = ?, updated_at = ? WHERE id = ?', [reportCount, new Date(), complaintId], { prepare: true });
      } else {
      complaintId = `RW-${String(districtCode).slice(0, 3)}-${Date.now()}`;
      reportCount = 1;
      await execute('INSERT INTO complaints (id, district, zone, status, description, lat, lng, road_id, authority_id, report_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [complaintId, districtCode, authorityId, 'FILED', body.description, body.lat, body.lng, body.roadId, authorityId, reportCount, new Date(), new Date()], { prepare: true });
    }

    if (shouldAttach) {
      await execute('INSERT INTO complaint_attachments (complaint_id, kind, file_path, file_mime, file_sha256, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [complaintId, 'PHOTO', `ipfs://${attachmentCid}`, attachmentMime, attachmentSha, JSON.stringify({ cid: attachmentCid, mime: attachmentMime, capturedAt: body.capturedAt ?? null, capturedLat: body.capturedLat ?? null, capturedLng: body.capturedLng ?? null }), new Date()], { prepare: true });
    }

    await execute('INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [isUuidLike(actorId) ? actorId : null, null, null, merged ? 'COMPLAINT_MERGED' : 'COMPLAINT_CREATED', 'complaint', complaintId, JSON.stringify({ district: districtCode, zone: authorityId, roadId: body.roadId, distanceM, merged, reportCount, attachmentCid, attachmentSha }), new Date()], { prepare: true });

    if (!merged) {
      const event = {
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

      try {
        await emitComplaintEvent(event, 'complaint.submitted');
      } catch (error) {
        console.error('[kafka] complaint.submitted publish failed', error);
      }
    }

    return res.status(201).json({
      ok: true,
      merged,
      complaint: {
        id: complaintId,
        district: districtCode,
        zone: authorityId,
        roadId: body.roadId,
        reportCount,
        status: 'FILED',
        description: body.description,
        lat: body.lat,
        lng: body.lng,
        attachmentCid,
        attachmentSha,
        distanceM: Math.round(distanceM)
      }
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid complaint payload', details: error.flatten() });
    }

    console.error('Error creating complaint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /complaints/:id - Get complaint by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const complaintRes = await execute('SELECT id, district, zone, status, description, lat, lng, road_id, authority_id, report_count, created_at, updated_at, fabric_txid, anchored_at, anchored_tx_hash FROM complaints WHERE id = ? LIMIT 1', [id], { prepare: true });
    const complaint = complaintRes.rows[0];
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const roadRes = await execute('SELECT name, road_type FROM roads_catalog WHERE id = ? LIMIT 1', [complaint.road_id], { prepare: true });

    const attachmentsRes = await execute('SELECT id, kind, file_path, file_mime, file_sha256, note, created_at FROM complaint_attachments WHERE complaint_id = ? ALLOW FILTERING', [id], { prepare: true });
    const attachments = (attachmentsRes.rows || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.json({ complaint: { ...complaint, road_name: roadRes.rows[0]?.name ?? null, road_type: roadRes.rows[0]?.road_type ?? null, attachments } });
  } catch (error) {
    console.error('Error fetching complaint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
