import { KafkaTopics, type ComplaintStatusChangedEvent, type ComplaintSubmittedEvent } from '@roadwatch/kafka';
import express from 'express';
import { z } from 'zod';
import { getContractorScorecard, trackAnalyticsEvent } from '../analytics/service.js';
import { execute } from '../cassandra.js';
import { publishKafkaEvent } from '../kafka/publish.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { assertDistrictAccess, assertZoneAccess, requireAuth, requireRole } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';

const router = express.Router();

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

  await execute(
    'INSERT INTO complaints (id, district, zone, status, description, lat, lng, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS',
    [id, body.district, body.zone, 'FILED', body.description, body.lat ?? null, body.lng ?? null, new Date(), new Date()],
    { prepare: true }
  );

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

    await publishKafkaEvent(KafkaTopics.complaintSubmitted, event, {
      key: id,
      idempotencyKey: event.idempotencyKey
    });
  } catch (e) {
    console.error('[kafka] complaint.submitted publish failed', e);
  }

  await execute(
    'INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [require('crypto').randomUUID(), user.sub, user.phoneHash, user.phone, 'COMPLAINT_CREATED', 'complaint', id, JSON.stringify({ district: body.district, zone: body.zone }), new Date()],
    { prepare: true }
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_CREATED',
    actorUserId: user.sub,
    complaintId: id,
    district: body.district,
    zone: body.zone,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    properties: { status: 'FILED' }
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

  res.json({ ok: true, complaint: { id, district: body.district, zone: body.zone, status: 'FILED', description: body.description, lat: body.lat ?? null, lng: body.lng ?? null, updatedAt: new Date().toISOString() } });
});

router.post('/complaints/:id/repair-verification', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z
    .object({
      beforeSha256: z.string().min(10),
      afterSha256: z.string().min(10),
      imageLat: z.number(),
      imageLng: z.number(),
      currentLat: z.number(),
      currentLng: z.number(),
      model: z.string().optional().default('roadwatch-repair-ai-v1')
    })
    .parse(req.body);

  const complaint = await execute('SELECT id, district, zone, lat, lng FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const liveToImageDistanceM = distanceMeters(
    { lat: body.currentLat, lng: body.currentLng },
    { lat: body.imageLat, lng: body.imageLng }
  );
  const complaintDistanceM = row.lat != null && row.lng != null
    ? distanceMeters({ lat: Number(row.lat), lng: Number(row.lng) }, { lat: body.currentLat, lng: body.currentLng })
    : liveToImageDistanceM;

  // Rule-based AI score: hash change + location consistency.
  const hashChangedScore = body.beforeSha256 !== body.afterSha256 ? 0.55 : 0.2;
  const locationScore = Math.max(0, 1 - complaintDistanceM / 120) * 0.45;
  const aiScore = Math.max(0, Math.min(1, hashChangedScore + locationScore));
  const repaired = aiScore >= 0.62 && complaintDistanceM <= 120;

  await execute(
    'INSERT INTO complaint_repair_verifications (complaint_id, before_sha256, after_sha256, image_lat, image_lng, current_lat, current_lng, distance_m, ai_score, repaired, model, details, verified_by_user_id, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      params.id,
      body.beforeSha256,
      body.afterSha256,
      body.imageLat,
      body.imageLng,
      body.currentLat,
      body.currentLng,
      complaintDistanceM,
      aiScore,
      repaired,
      body.model,
      JSON.stringify({ liveToImageDistanceM, complaintDistanceM }),
      user.sub,
      new Date()
    ],
    { prepare: true }
  );

  await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [require('crypto').randomUUID(), user.sub, user.phoneHash, user.phone, 'REPAIR_AI_VERIFIED', 'complaint', params.id, JSON.stringify({ repaired, aiScore, complaintDistanceM, model: body.model }), new Date()], { prepare: true });

  res.json({ ok: true, repaired, aiScore, complaintDistanceM });
});

router.post('/complaints/:id/status', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string; role: string; districts: string[]; zones: string[] };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ status: z.string().min(1) }).parse(req.body);

  const complaint = await execute('SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (row.status === body.status) {
    return res.json({ ok: true, unchanged: true });
  }

  if (String(body.status).toUpperCase() === 'RESOLVED') {
    const verification = await execute('SELECT repaired, ai_score, distance_m, verified_at FROM complaint_repair_verifications WHERE complaint_id = ? LIMIT 1', [params.id], { prepare: true });
    const v = verification.rows[0];
    if (!v || !v.repaired) {
      return res.status(400).json({
        error: 'Complaint cannot be resolved before repair verification passes',
        verification: v ?? null
      });
    }
  }

  await execute('UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?', [body.status, new Date(), params.id], { prepare: true });

  try {
    const event: ComplaintStatusChangedEvent = {
      type: 'complaint.status.changed',
      idempotencyKey: `complaint:${params.id}:status:${row.status}->${body.status}`,
      occurredAt: new Date().toISOString(),
      version: 1,
      complaintId: params.id,
      fromStatus: row.status,
      toStatus: body.status,
      changedBy: { actorType: 'authority', actorId: user.sub }
    };

    await publishKafkaEvent(KafkaTopics.complaintStatusChanged, event, {
      key: params.id,
      idempotencyKey: event.idempotencyKey
    });
  } catch (e) {
    console.error('[kafka] complaint.status.changed publish failed', e);
  }

  await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [require('crypto').randomUUID(), user.sub, user.phoneHash, user.phone, 'COMPLAINT_STATUS_CHANGED', 'complaint', params.id, JSON.stringify({ from: row.status, to: body.status }), new Date()], { prepare: true });

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

  const updated = await execute('SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
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

  const complaint = await execute('SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (row.status === 'ESCALATED') {
    return res.json({ ok: true, unchanged: true });
  }

  await execute('UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?', ['ESCALATED', new Date(), params.id], { prepare: true });

  try {
    const event: ComplaintStatusChangedEvent = {
      type: 'complaint.status.changed',
      idempotencyKey: `complaint:${params.id}:status:${row.status}->ESCALATED`,
      occurredAt: new Date().toISOString(),
      version: 1,
      complaintId: params.id,
      fromStatus: row.status,
      toStatus: 'ESCALATED',
      changedBy: { actorType: 'authority', actorId: user.sub }
    };

    await publishKafkaEvent(KafkaTopics.complaintStatusChanged, event, {
      key: params.id,
      idempotencyKey: event.idempotencyKey
    });
  } catch (e) {
    console.error('[kafka] complaint.status.changed publish failed', e);
  }

  await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [require('crypto').randomUUID(), user.sub, user.phoneHash, user.phone, 'COMPLAINT_ESCALATED', 'complaint', params.id, JSON.stringify({ reason: body.reason ?? null }), new Date()], { prepare: true });

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

  const updated = await execute('SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
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

  const complaint = await execute('SELECT id, district, zone, status FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [require('crypto').randomUUID(), user.sub, user.phoneHash, user.phone, 'SLA_WARNING', 'complaint', params.id, JSON.stringify({ status: row.status }), new Date()], { prepare: true });

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
    // Expand district array into an IN (...) clause for Cassandra
    const ds = user.districts;
    if (Array.isArray(ds) && ds.length) {
      const placeholders = ds.map(() => '?').join(', ');
      where.push(`district IN (${placeholders})`);
      params.push(...ds);
    }
  }

  if (query.zone) {
    if (!assertZoneAccess(user as any, query.zone)) return res.status(403).json({ error: 'Forbidden' });
    params.push(query.zone);
    where.push(`zone = $${params.length}`);
  } else if (user.role !== 'CE' && !user.zones.includes('ALL')) {
    const zs = user.zones;
    if (Array.isArray(zs) && zs.length) {
      const placeholders = zs.map(() => '?').join(', ');
      where.push(`zone IN (${placeholders})`);
      params.push(...zs);
    }
  }

  if (query.status) {
    params.push(query.status);
    where.push(`status = $${params.length}`);
  }

  const sql = `SELECT id, district, zone, status, description, lat, lng, created_at, updated_at, fabric_txid FROM complaints ${where.length ? `WHERE ${where.join(' AND ')}` : ''} LIMIT 200`;
  const r = await execute(sql + ' ALLOW FILTERING', params, { prepare: true });
  res.json({ complaints: r.rows });
});

router.post('/complaints/:id/resolve', requireAuth, async (req, res) => {
  const user = (req as any).user as { sub: string; phone: string; phoneHash: string };
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ resolutionNote: z.string().optional() }).parse(req.body);

  const complaint = await execute('SELECT id, district, zone, status, description, lat, lng FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  // RBAC: EE must be within zone/district.
  const fullUser = (req as any).user as any;
  if (!assertDistrictAccess(fullUser, row.district) || !assertZoneAccess(fullUser, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (row.status === 'RESOLVED') {
    return res.json({ ok: true, unchanged: true });
  }

  const verification = await execute('SELECT repaired, ai_score, distance_m, verified_at FROM complaint_repair_verifications WHERE complaint_id = ? LIMIT 1', [params.id], { prepare: true });
  const v = verification.rows[0];
  if (!v || !v.repaired) {
    return res.status(400).json({
      error: 'Complaint cannot be resolved before repair verification passes',
      verification: v ?? null
    });
  }

  await execute('UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?', ['RESOLVED', new Date(), params.id], { prepare: true });

  try {
    const event: ComplaintStatusChangedEvent = {
      type: 'complaint.status.changed',
      idempotencyKey: `complaint:${params.id}:status:${row.status}->RESOLVED`,
      occurredAt: new Date().toISOString(),
      version: 1,
      complaintId: params.id,
      fromStatus: row.status,
      toStatus: 'RESOLVED',
      changedBy: { actorType: 'authority', actorId: user.sub }
    };

    await publishKafkaEvent(KafkaTopics.complaintStatusChanged, event, {
      key: params.id,
      idempotencyKey: event.idempotencyKey
    });
  } catch (e) {
    console.error('[kafka] complaint.status.changed publish failed', e);
  }

  await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [require('crypto').randomUUID(), user.sub, user.phoneHash, user.phone, 'COMPLAINT_RESOLVED', 'complaint', params.id, JSON.stringify({ resolutionNote: body.resolutionNote ?? null }), new Date()], { prepare: true });

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

  const updated = await execute('SELECT id, district, zone, status, description, lat, lng, updated_at FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
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

  const complaint = await execute('SELECT id, district, zone, status, lat, lng FROM complaints WHERE id = ? LIMIT 1', [params.id], { prepare: true });
  const row = complaint.rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!assertDistrictAccess(user as any, row.district) || !assertZoneAccess(user as any, row.zone)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const contractor = await execute('SELECT id, name FROM contractors WHERE id = ? LIMIT 1', [body.contractorId], { prepare: true });
  if (!contractor.rows[0]) return res.status(400).json({ error: 'Unknown contractorId' });

  // Upsert assignment: use INSERT to set values (Cassandra upsert semantics)
  await execute('INSERT INTO complaint_assignments (complaint_id, contractor_id, expected_resolution_days, assigned_by_user_id, assigned_at, notes) VALUES (?, ?, ?, ?, ?, ?)', [params.id, body.contractorId, body.expectedResolutionDays ?? null, user.sub, new Date(), body.notes ?? null], { prepare: true });

  await execute('INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [require('crypto').randomUUID(), user.sub, user.phoneHash, user.phone, 'COMPLAINT_ASSIGNED', 'complaint', params.id, JSON.stringify({ contractorId: body.contractorId, expectedResolutionDays: body.expectedResolutionDays ?? null }), new Date()], { prepare: true });

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
    const ds = user.districts;
    if (Array.isArray(ds) && ds.length) {
      const placeholders = ds.map(() => '?').join(', ');
      where.push(`district IN (${placeholders})`);
      params.push(...ds);
    }
  }

  // Aggregate by fetching statuses and counting in application code (Cassandra lacks GROUP BY)
  const rr = await execute(`SELECT status FROM complaints ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ALLOW FILTERING`, params, { prepare: true });
  const byStatus: Record<string, number> = {};
  for (const row of rr.rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  res.json({ byStatus, totals: { total: Object.values(byStatus).reduce((a, b) => a + b, 0) } });
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
    const ds = user.districts;
    if (Array.isArray(ds) && ds.length) {
      const placeholders = ds.map(() => '?').join(', ');
      where.push(`district IN (${placeholders})`);
      params.push(...ds);
    }
  }

  // Simple deterministic budget: INR 25k per pending complaint, INR 10k per in-progress.
  const rr2 = await execute(`SELECT status FROM complaints WHERE ${where.join(' AND ')} ALLOW FILTERING`, params, { prepare: true });
  const counts: Record<string, number> = {};
  for (const row of rr2.rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const pending = counts['FILED'] ?? 0;
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
  const r = await execute('SELECT id, actor_phone_masked, actor_phone_hash, action, target_type, target_id, details, fabric_txid, created_at FROM audit_log LIMIT 200', [], { prepare: true });
  res.json({ entries: r.rows });
});

router.get('/performance/evaluation', requireAuth, requireRole(['CE', 'EE']), async (req, res) => {
  const user = (req as any).user as any;
  const district = typeof req.query.district === 'string' ? req.query.district : undefined;
  const zone = typeof req.query.zone === 'string' ? req.query.zone : undefined;

  if (district && !assertDistrictAccess(user, district)) return res.status(403).json({ error: 'Forbidden' });
  if (zone && !assertZoneAccess(user, zone)) return res.status(403).json({ error: 'Forbidden' });

  const whereParts: string[] = [];
  const values: any[] = [];
  if (district) {
    values.push(district);
    whereParts.push(`c.district = $${values.length}`);
  }
  if (zone) {
    values.push(zone);
    whereParts.push(`c.zone = $${values.length}`);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  // Employees performance: PoC implementation — fetch users and audit entries and aggregate in JS (may be slow)
  const usersRes = await execute(`SELECT id, role, phone_masked FROM users ${whereSql} LIMIT 200`, values, { prepare: true });
  const employeeRows = [] as any[];
  for (const urow of usersRes.rows) {
    const audits = await execute('SELECT action FROM audit_log WHERE actor_user_id = ? ALLOW FILTERING', [urow.id], { prepare: true });
    const assigned = audits.rows.filter((a: any) => a.action === 'COMPLAINT_ASSIGNED').length;
    const resolved = audits.rows.filter((a: any) => a.action === 'COMPLAINT_RESOLVED').length;
    const escalated = audits.rows.filter((a: any) => a.action === 'COMPLAINT_ESCALATED').length;
    const sla_warnings = audits.rows.filter((a: any) => a.action === 'SLA_WARNING').length;
    const karma = resolved * 6 + assigned * 2 - escalated * 4 - sla_warnings * 3;
    employeeRows.push({ userId: urow.id, role: urow.role, phoneMasked: urow.phone_masked, assigned, resolved, escalated, slaWarnings: sla_warnings, karma });
  }

  employeeRows.sort((a, b) => b.karma - a.karma);
  const employeesRanked = employeeRows.map((row, idx) => ({ ...row, rank: idx + 1 }));

  const contractors = await getContractorScorecard({ district, zone, limit: 200 });
  const contractorRows = contractors
    .map((c) => {
      const onTime = c.onTimeRate == null ? 0 : c.onTimeRate * 100;
      const karma = c.resolvedCount * 5 + Math.round(onTime) - c.slaBreaches * 4 - c.openCount;
      return {
        contractorId: c.contractorId,
        contractorName: c.contractorName,
        assignedCount: c.assignedCount,
        resolvedCount: c.resolvedCount,
        openCount: c.openCount,
        slaBreaches: c.slaBreaches,
        onTimeRate: c.onTimeRate,
        avgResolutionDays: c.avgResolutionDays,
        karma
      };
    })
    .sort((a, b) => b.karma - a.karma)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  res.json({
    district: district ?? null,
    zone: zone ?? null,
    employees: employeesRanked,
    contractors: contractorRows
  });
});

export default router;
