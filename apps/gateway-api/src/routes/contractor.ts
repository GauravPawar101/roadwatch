import express from 'express';
import { z } from 'zod';
import { trackAnalyticsEvent } from '../analytics/service.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { pool } from '../postgres.js';
import { requireAuth, requireRole, type AuthedRequest } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';
import { uuidv7 } from '../uuid.js';

const router = express.Router();

async function loadAssignedComplaint(complaintId: string) {
  const result = await pool.query(
    `SELECT c.id, c.district, c.zone, c.status, c.description, c.lat, c.lng, c.updated_at, c.metadata,
            ca.contractor_id, ca.status AS assignment_status, ca.progress_pct, ca.progress_note, ca.resolution_report
     FROM complaints c
     LEFT JOIN complaint_assignments ca ON ca.complaint_id = c.id
     WHERE c.id = $1
     LIMIT 1`,
    [complaintId]
  );

  return result.rows[0] as
    | {
        id: string;
        district: string;
        zone: string;
        status: string;
        description: string;
        lat: number | null;
        lng: number | null;
        updated_at: Date;
        metadata: Record<string, unknown> | null;
        contractor_id: string | null;
        assignment_status: string | null;
        progress_pct: number | null;
        progress_note: string | null;
        resolution_report: Record<string, unknown> | null;
      }
    | undefined;
}

router.get('/complaints', requireAuth, requireRole(['CONTRACTOR']), async (_req, res) => {
  const rows = await pool.query(
    `SELECT c.id, c.district, c.zone, c.status, c.description, c.lat, c.lng, c.updated_at,
            ca.status AS assignment_status, ca.progress_pct, ca.progress_note, ca.completed_at
     FROM complaints c
     INNER JOIN complaint_assignments ca ON ca.complaint_id = c.id
     ORDER BY ca.assigned_at DESC NULLS LAST, c.created_at DESC
     LIMIT 200`
  );

  res.json({
    complaints: rows.rows.map((row) => ({
      id: row.id,
      district: row.district,
      zone: row.zone,
      status: row.status,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      updatedAt: row.updated_at,
      assignmentStatus: row.assignment_status,
      progressPct: row.progress_pct,
      progressNote: row.progress_note,
      completedAt: row.completed_at
    }))
  });
});

router.post('/complaints/:id/accept', requireAuth, requireRole(['CONTRACTOR']), async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const complaint = await loadAssignedComplaint(params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (!complaint.contractor_id) return res.status(400).json({ error: 'Complaint is not assigned to a contractor' });

  await pool.query(
    `UPDATE complaint_assignments
     SET status = 'ACCEPTED', accepted_at = NOW(), contractor_user_id = $2
     WHERE complaint_id = $1`,
    [params.id, user.sub]
  );

  await pool.query(`UPDATE complaints SET status = 'IN_PROGRESS', updated_at = NOW() WHERE id = $1`, [params.id]);

  await pool.query(
    `INSERT INTO complaint_work_logs (id, complaint_id, contractor_id, user_id, phase, progress_pct, note, report, created_at)
     VALUES ($1, $2, $3, $4, 'ACCEPTED', 0, $5, $6::jsonb, NOW())`,
    [uuidv7(), params.id, complaint.contractor_id, user.sub, 'Contractor accepted assignment', JSON.stringify({ acceptedAt: new Date().toISOString() })]
  );

  await trackAnalyticsEvent({
    type: 'CONTRACTOR_ACCEPTED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { contractorId: complaint.contractor_id }
  });

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: complaint.id,
      district: complaint.district,
      zone: complaint.zone,
      status: 'IN_PROGRESS',
      description: complaint.description,
      lat: complaint.lat,
      lng: complaint.lng,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'status_change',
      title: `Complaint ${params.id} accepted`,
      body: 'Contractor accepted the assignment.',
      data: { complaintId: params.id, contractorId: complaint.contractor_id },
      audience: { kind: 'jurisdiction', district: complaint.district, zone: complaint.zone },
      critical: false
    }
  });

  res.json({ ok: true, status: 'ACCEPTED' });
});

router.post('/complaints/:id/progress', requireAuth, requireRole(['CONTRACTOR']), async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ progressPct: z.number().int().min(0).max(100), note: z.string().max(2000).optional() }).parse(req.body);
  const complaint = await loadAssignedComplaint(params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (!complaint.contractor_id) return res.status(400).json({ error: 'Complaint is not assigned to a contractor' });

  await pool.query(
    `UPDATE complaint_assignments
     SET status = 'IN_PROGRESS', progress_pct = $2, progress_note = $3, contractor_user_id = $4
     WHERE complaint_id = $1`,
    [params.id, body.progressPct, body.note ?? null, user.sub]
  );

  await pool.query(`UPDATE complaints SET updated_at = NOW() WHERE id = $1`, [params.id]);
  await pool.query(
    `INSERT INTO complaint_work_logs (id, complaint_id, contractor_id, user_id, phase, progress_pct, note, report, created_at)
     VALUES ($1, $2, $3, $4, 'PROGRESS', $5, $6, $7::jsonb, NOW())`,
    [uuidv7(), params.id, complaint.contractor_id, user.sub, body.progressPct, body.note ?? null, JSON.stringify({ progressPct: body.progressPct })]
  );

  await trackAnalyticsEvent({
    type: 'CONTRACTOR_PROGRESS',
    actorUserId: user.sub,
    complaintId: params.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { progressPct: body.progressPct, note: body.note ?? null }
  });

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: complaint.id,
      district: complaint.district,
      zone: complaint.zone,
      status: complaint.status === 'IN_PROGRESS' ? complaint.status : 'IN_PROGRESS',
      description: complaint.description,
      lat: complaint.lat,
      lng: complaint.lng,
      updatedAt: new Date().toISOString()
    }
  });

  res.json({ ok: true, status: 'IN_PROGRESS', progressPct: body.progressPct });
});

router.post('/complaints/:id/complete', requireAuth, requireRole(['CONTRACTOR']), async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ report: z.string().min(1), proofUrl: z.string().url().optional() }).parse(req.body);
  const complaint = await loadAssignedComplaint(params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (!complaint.contractor_id) return res.status(400).json({ error: 'Complaint is not assigned to a contractor' });

  await pool.query(
    `UPDATE complaint_assignments
     SET status = 'SUBMITTED',
         progress_pct = 100,
         progress_note = $2,
         resolution_report = $3::jsonb,
         completed_at = NOW(),
         inspection_due_at = NOW() + ($5::text || ' hours')::interval,
         inspection_completed_at = NULL,
         inspection_overdue_notified = false,
         contractor_user_id = $4
     WHERE complaint_id = $1`,
    [
      params.id,
      body.report,
      JSON.stringify({ report: body.report, proofUrl: body.proofUrl ?? null }),
      user.sub,
      String(process.env.INSPECTION_GRACE_HOURS ?? 24),
    ]
  );

  await pool.query(`UPDATE complaints SET status = 'RESOLUTION_SUBMITTED', updated_at = NOW() WHERE id = $1`, [params.id]);
  await pool.query(
    `INSERT INTO complaint_work_logs (id, complaint_id, contractor_id, user_id, phase, progress_pct, note, report, created_at)
     VALUES ($1, $2, $3, $4, 'COMPLETED', 100, $5, $6::jsonb, NOW())`,
    [uuidv7(), params.id, complaint.contractor_id, user.sub, body.report, JSON.stringify({ report: body.report, proofUrl: body.proofUrl ?? null })]
  );

  await trackAnalyticsEvent({
    type: 'CONTRACTOR_COMPLETED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { proofUrl: body.proofUrl ?? null }
  });

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: complaint.id,
      district: complaint.district,
      zone: complaint.zone,
      status: 'RESOLUTION_SUBMITTED',
      description: complaint.description,
      lat: complaint.lat,
      lng: complaint.lng,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'status_change',
      title: `Complaint ${params.id} work complete`,
      body: body.report,
      data: { complaintId: params.id, contractorId: complaint.contractor_id, proofUrl: body.proofUrl ?? null },
      audience: { kind: 'jurisdiction', district: complaint.district, zone: complaint.zone },
      critical: true
    }
  });

  res.json({ ok: true, status: 'RESOLUTION_SUBMITTED' });
});

export default router;
