import { KafkaProducer, KafkaTopics, type ComplaintSubmittedEvent } from '@roadwatch/kafka';
import express from 'express';
import { z } from 'zod';
import { trackAnalyticsEvent } from '../analytics/service.js';
import { pool } from '../db.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { assertDistrictAccess, assertZoneAccess, requireAuth, requireRole } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';

const router = express.Router();

function kafkaConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.UPSTASH_KAFKA_REST_URL?.trim() &&
      env.UPSTASH_KAFKA_REST_USERNAME?.trim() &&
      env.UPSTASH_KAFKA_REST_PASSWORD?.trim()
  );
}

router.post('/complaints', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as {
    sub: string;
    phone: string;
    phoneHash: string;
    role: string;
    districts: string[];
    zones: string[];
  };

  const body = z
    .object({
      id: z.string().min(1).optional(),
      district: z.string().min(1),
      zone: z.string().min(1),
      description: z.string().min(1),
      lat: z.number().optional().nullable(),
      lng: z.number().optional().nullable()
    })
    .parse(req.body);

  if (!assertDistrictAccess(user as any, body.district) || !assertZoneAccess(user as any, body.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const generatedId = `RW-${body.district.slice(0, 3).toUpperCase()}-${Date.now()}`;
  const id = body.id ?? generatedId;

  await pool.query(
    `INSERT INTO complaints (id, district, zone, status, description, lat, lng)
     VALUES ($1, $2, $3, 'PENDING', $4, $5, $6)
     ON CONFLICT (id) DO NOTHING;`,
    [id, body.district, body.zone, body.description, body.lat ?? null, body.lng ?? null]
  );

  if (kafkaConfigured()) {
    try {
      const event: ComplaintSubmittedEvent = {
        type: 'complaint.submitted',
        idempotencyKey: `complaint:${id}:submitted`,
        occurredAt: new Date().toISOString(),
        version: 1,
        complaintId: id,
        district: body.district,
        zone: body.zone,
        lat: body.lat ?? undefined,
        lng: body.lng ?? undefined,
        description: body.description
      };

      const producer = new KafkaProducer();
      await producer.publish(KafkaTopics.complaintSubmitted, event, { key: id });
    } catch (e) {
      console.error('[kafka] complaint.submitted publish failed', e);
    }
  }

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_CREATED', 'complaint', $4, $5);`,
    [user.sub, user.phoneHash, user.phone, id, { district: body.district, zone: body.zone }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_CREATED',
    actorUserId: user.sub,
    complaintId: id,
    district: body.district,
    zone: body.zone,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    properties: { status: 'PENDING' }
  });

  broadcastComplaintEvent({
    type: 'complaint_created',
    complaint: {
      id,
      district: body.district,
      zone: body.zone,
      status: 'PENDING',
      description: body.description,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'new_complaint',
      title: `New complaint ${id}`,
      body: `New complaint filed in ${body.district} / ${body.zone}.`,
      data: { complaintId: id, district: body.district, zone: body.zone },
      audience: { kind: 'jurisdiction', district: body.district, zone: body.zone },
      critical: false
    }
  });

  res.json({ ok: true, complaint: { id } });
});

router.post('/complaints/:id/status', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ status: z.string().min(1) }).parse(req.body);

  const complaint = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await pool.query(`UPDATE complaints SET status = $2, updated_at = now() WHERE id = $1;`, [params.id, body.status]);

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_STATUS_CHANGED', 'complaint', $4, $5);`,
    [user.sub, user.phoneHash, user.phone, params.id, { from: row.status, to: body.status }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_STATUS_CHANGED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { from: row.status, to: body.status }
  });

  const updated = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );
  const u = updated.rows[0];

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: u.id,
      district: u.district,
      zone: u.zone,
      status: u.status,
      description: u.description,
      lat: u.lat,
      lng: u.lng,
      updatedAt: new Date(u.updated_at).toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'status_change',
      title: `Complaint ${u.id} status changed`,
      body: `Status updated to ${u.status} for a complaint in ${u.district} / ${u.zone}.`,
      data: { complaintId: u.id, district: u.district, zone: u.zone, status: u.status },
      audience: { kind: 'jurisdiction', district: u.district, zone: u.zone },
      critical: false
    }
  });

  res.json({ ok: true });
});

router.post('/complaints/:id/escalate', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ reason: z.string().optional() }).parse(req.body);

  const complaint = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await pool.query(`UPDATE complaints SET status = 'ESCALATED', updated_at = now() WHERE id = $1;`, [params.id]);

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_ESCALATED', 'complaint', $4, $5);`,
    [user.sub, user.phoneHash, user.phone, params.id, { reason: body.reason ?? null }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_ESCALATED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { reason: body.reason ?? null }
  });

  const updated = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );
  const u = updated.rows[0];

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: u.id,
      district: u.district,
      zone: u.zone,
      status: u.status,
      description: u.description,
      lat: u.lat,
      lng: u.lng,
      updatedAt: new Date(u.updated_at).toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'escalation',
      title: `Complaint ${u.id} escalated`,
      body: `Escalation raised for ${u.district} / ${u.zone}.`,
      data: { complaintId: u.id, district: u.district, zone: u.zone, reason: body.reason ?? null },
      audience: { kind: 'jurisdiction', district: u.district, zone: u.zone },
      critical: true
    }
  });

  res.json({ ok: true });
});

router.post('/complaints/:id/sla-warning', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ message: z.string().optional() }).parse(req.body);

  const complaint = await pool.query(
    `SELECT id, district, zone, status FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'SLA_WARNING', 'complaint', $4, $5);`,
    [user.sub, user.phoneHash, user.phone, params.id, { status: row.status }]
  );

  await trackAnalyticsEvent({
    type: 'SLA_WARNING',
    actorUserId: user.sub,
    complaintId: params.id,
    district: row.district,
    zone: row.zone,
    properties: { status: row.status, message: body.message ?? null }
  });

  await createAndFanoutNotification({
    message: {
      type: 'sla_warning',
      title: `SLA warning for ${row.id}`,
      body: body.message ?? `SLA risk detected for a complaint in ${row.district} / ${row.zone}.`,
      data: { complaintId: row.id, district: row.district, zone: row.zone, status: row.status },
      audience: { kind: 'jurisdiction', district: row.district, zone: row.zone },
      critical: true
    }
  });

  res.json({ ok: true });
});

router.get('/complaints', requireAuth, async (req, res) => {
  const user = (req as any).user as { role: string; districts: string[]; zones: string[] };

  const query = z
    .object({
      district: z.string().optional(),
      zone: z.string().optional(),
      status: z.string().optional()
    })
    .parse(req.query);

  const where: string[] = [];
  const params: any[] = [];

  if (query.district) {
    if (!assertDistrictAccess(user as any, query.district)) return res.status(403).json({ error: 'Forbidden' });
    params.push(query.district);
    where.push(`district = $${params.length}`);
  } else if (user.role !== 'CE' && !user.districts.includes('ALL')) {
    params.push(user.districts);
    where.push(`district = ANY($${params.length}::text[])`);
  }

  if (query.zone) {
    if (!assertZoneAccess(user as any, query.zone)) return res.status(403).json({ error: 'Forbidden' });
    params.push(query.zone);
    where.push(`zone = $${params.length}`);
  } else if (user.role !== 'CE' && !user.zones.includes('ALL')) {
    params.push(user.zones);
    where.push(`zone = ANY($${params.length}::text[])`);
  }

  if (query.status) {
    params.push(query.status);
    where.push(`status = $${params.length}`);
  }

  const sql = `
    SELECT id, district, zone, status, description, lat, lng, created_at, updated_at, fabric_txid
    FROM complaints
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY updated_at DESC
    LIMIT 200;
  `;

  const r = await pool.query(sql, params);
  res.json({ complaints: r.rows });
});

router.post('/complaints/:id/resolve', requireAuth, async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ resolutionNote: z.string().optional() }).parse(req.body);

  const complaint = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  // RBAC: EE must be within zone/district.
  const fullUser = (req as any).user as any;
  if (!assertDistrictAccess(fullUser, row.district) || !assertZoneAccess(fullUser, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await pool.query(
    `UPDATE complaints SET status = 'RESOLVED', updated_at = now() WHERE id = $1;`,
    [params.id]
  );

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_RESOLVED', 'complaint', $4, $5);`,
    [user.sub, user.phoneHash, user.phone, params.id, { resolutionNote: body.resolutionNote ?? null }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_RESOLVED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { resolutionNote: body.resolutionNote ?? null }
  });

  const updated = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );

  const u = updated.rows[0];
  broadcastComplaintEvent({
    type: 'complaint_resolved',
    complaint: {
      id: u.id,
      district: u.district,
      zone: u.zone,
      status: u.status,
      description: u.description,
      lat: u.lat,
      lng: u.lng,
      updatedAt: new Date(u.updated_at).toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'resolved',
      title: `Complaint ${u.id} resolved`,
      body: `A complaint in ${u.district} / ${u.zone} was marked RESOLVED.`,
      data: {
        complaintId: u.id,
        district: u.district,
        zone: u.zone,
        status: u.status
      },
      audience: { kind: 'jurisdiction', district: u.district, zone: u.zone },
      critical: false
    }
  });

  res.json({ ok: true });
});

router.post('/complaints/:id/assign', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z
    .object({
      contractorId: z.string().min(1),
      expectedResolutionDays: z.coerce.number().int().positive().optional(),
      notes: z.string().max(500).optional()
    })
    .parse(req.body);

  const complaint = await pool.query(
    `SELECT id, district, zone, status, lat, lng FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.id]
  );
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const contractor = await pool.query(`SELECT id, name FROM contractors WHERE id = $1 LIMIT 1;`, [body.contractorId]);
  if (!contractor.rows[0]) return res.status(400).json({ error: 'Unknown contractorId' });

  await pool.query(
    `INSERT INTO complaint_assignments (complaint_id, contractor_id, expected_resolution_days, assigned_by_user_id, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (complaint_id)
     DO UPDATE SET
       contractor_id = EXCLUDED.contractor_id,
       expected_resolution_days = EXCLUDED.expected_resolution_days,
       assigned_by_user_id = EXCLUDED.assigned_by_user_id,
       assigned_at = now(),
       notes = EXCLUDED.notes;`,
    [params.id, body.contractorId, body.expectedResolutionDays ?? null, user.sub, body.notes ?? null]
  );

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_ASSIGNED', 'complaint', $4, $5);`,
    [user.sub, user.phoneHash, user.phone, params.id, { contractorId: body.contractorId, expectedResolutionDays: body.expectedResolutionDays ?? null }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_ASSIGNED',
    actorUserId: user.sub,
    complaintId: params.id,
    contractorId: body.contractorId,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { expectedResolutionDays: body.expectedResolutionDays ?? null, notes: body.notes ?? null }
  });

  await createAndFanoutNotification({
    message: {
      type: 'assignment',
      title: `Complaint ${params.id} assigned`,
      body: `Assigned to contractor ${body.contractorId} in ${row.district} / ${row.zone}.`,
      data: { complaintId: params.id, district: row.district, zone: row.zone, contractorId: body.contractorId },
      audience: { kind: 'jurisdiction', district: row.district, zone: row.zone },
      critical: false
    }
  });

  res.json({ ok: true });
});

router.get('/analytics', requireAuth, async (req, res) => {
  const user = (req as any).user as any;

  // District scoping: EE only.
  const district = typeof req.query.district === 'string' ? req.query.district : undefined;
  if (district && !assertDistrictAccess(user, district)) return res.status(403).json({ error: 'Forbidden' });

  const where: string[] = [];
  const params: any[] = [];
  if (district) {
    params.push(district);
    where.push(`district = $${params.length}`);
  } else if (user.role !== 'CE' && !user.districts.includes('ALL')) {
    params.push(user.districts);
    where.push(`district = ANY($${params.length}::text[])`);
  }

  const sql = `
    SELECT status, count(*)::int as count
    FROM complaints
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY status;
  `;
  const r = await pool.query(sql, params);

  const byStatus: Record<string, number> = {};
  for (const row of r.rows) byStatus[row.status] = row.count;

  res.json({
    byStatus,
    totals: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0)
    }
  });
});

router.get('/budget', requireAuth, async (req, res) => {
  const user = (req as any).user as any;
  const district = typeof req.query.district === 'string' ? req.query.district : undefined;
  if (district && !assertDistrictAccess(user, district)) return res.status(403).json({ error: 'Forbidden' });

  const where: string[] = [`status <> 'RESOLVED'`];
  const params: any[] = [];
  if (district) {
    params.push(district);
    where.push(`district = $${params.length}`);
  } else if (user.role !== 'CE' && !user.districts.includes('ALL')) {
    params.push(user.districts);
    where.push(`district = ANY($${params.length}::text[])`);
  }

  // Simple deterministic budget: INR 25k per pending complaint, INR 10k per in-progress.
  const r = await pool.query(
    `SELECT status, count(*)::int as count FROM complaints WHERE ${where.join(' AND ')} GROUP BY status;`,
    params
  );
  const counts: Record<string, number> = {};
  for (const row of r.rows) counts[row.status] = row.count;
  const pending = counts['PENDING'] ?? 0;
  const inProgress = counts['IN_PROGRESS'] ?? 0;
  const rejected = counts['REJECTED'] ?? 0;

  const estimatedBacklogCostINR = pending * 25000 + inProgress * 10000 + rejected * 2000;
  res.json({
    district: district ?? null,
    estimatedBacklogCostINR,
    model: {
      PENDING: 25000,
      IN_PROGRESS: 10000,
      REJECTED: 2000
    },
    counts
  });
});

router.get('/audit', requireAuth, requireRole(['CE']), async (req, res) => {
  const r = await pool.query(
    `SELECT id, actor_phone_masked, actor_phone_hash, action, target_type, target_id, details, fabric_txid, created_at
     FROM audit_log
     ORDER BY created_at DESC
     LIMIT 200;`
  );
  res.json({ entries: r.rows });
});

export default router;
