import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { trackAnalyticsEvent } from '../analytics/service.js';
import { pool } from '../db.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { requireAuth, requireRole, type AuthedRequest } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';

const router = express.Router();

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'complaints');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
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
      lng: z.coerce.number()
    })
    .parse(req.body);

  const road = await pool.query(
    `SELECT rc.id, rc.authority_id, rc.geometry, d.code AS district_code
     FROM roads_catalog rc
     JOIN districts d ON d.id = rc.district_id
     WHERE rc.id = $1
     LIMIT 1;`,
    [body.roadId]
  );

  const roadRow = road.rows[0];
  if (!roadRow) return res.status(404).json({ error: 'Road not found' });
  if (!roadRow.geometry) return res.status(400).json({ error: 'Road geometry not available for this road' });

  const distanceM = minDistanceToGeometryMeters({ lat: body.lat, lng: body.lng }, roadRow.geometry);
  if (!Number.isFinite(distanceM)) return res.status(400).json({ error: 'Invalid road geometry' });
  if (distanceM > 100) {
    return res.status(400).json({ error: 'You must be within 100m of the selected road', distanceM: Math.round(distanceM) });
  }

  const districtCode = String(roadRow.district_code ?? 'UNK').toUpperCase();
  const authorityId = String(roadRow.authority_id ?? 'UNKNOWN');

  const id = `RW-${districtCode.slice(0, 3)}-${Date.now()}`;

  await pool.query(
    `INSERT INTO complaints (id, district, zone, status, description, lat, lng, road_id, authority_id)
     VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING;`,
    [id, districtCode, authorityId, body.description, body.lat, body.lng, body.roadId, authorityId]
  );

  const file = (req as any).file as Express.Multer.File | undefined;
  if (file?.path) {
    const sha = await sha256File(file.path);
    await pool.query(
      `INSERT INTO complaint_attachments (complaint_id, kind, file_path, file_mime, file_sha256)
       VALUES ($1, 'PHOTO', $2, $3, $4);`,
      [id, file.path, file.mimetype ?? null, sha]
    );
  }

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_CREATED', 'complaint', $4, $5);`,
    [user.sub, user.phoneHash, user.phone, id, { district: districtCode, zone: authorityId, roadId: body.roadId, distanceM }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_CREATED',
    actorUserId: user.sub,
    complaintId: id,
    district: districtCode,
    zone: authorityId,
    lat: body.lat,
    lng: body.lng,
    properties: { status: 'PENDING', roadId: body.roadId, distanceM }
  });

  broadcastComplaintEvent({
    type: 'complaint_created',
    complaint: {
      id,
      district: districtCode,
      zone: authorityId,
      status: 'PENDING',
      description: body.description,
      lat: body.lat,
      lng: body.lng,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'new_complaint',
      title: `New complaint ${id}`,
      body: `New complaint filed in ${districtCode} / ${authorityId}.`,
      data: { complaintId: id, district: districtCode, zone: authorityId, roadId: body.roadId },
      audience: { kind: 'jurisdiction', district: districtCode, zone: authorityId },
      critical: false
    }
  });

  res.json({ ok: true, complaint: { id } });
});

export default router;
