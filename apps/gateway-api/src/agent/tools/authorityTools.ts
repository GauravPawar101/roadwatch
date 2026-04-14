import { trackAnalyticsEvent } from '../../analytics/service.js';
import type { JwtClaims } from '../../auth/jwt.js';
import { pool } from '../../db.js';
import { createAndFanoutNotification } from '../../notifications/service.js';
import { assertDistrictAccess, assertZoneAccess } from '../../rbac.js';
import { broadcastComplaintEvent } from '../../realtime/sse.js';
import type { ChatMessage, ToolCall, ToolDefinition } from '../llm/types.js';

function tool(name: string, description: string, parameters: Record<string, any>): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters
    }
  };
}

export const AUTHORITY_TOOLS: ToolDefinition[] = [
  tool(
    'update_complaint_status',
    'Update a complaint status and record an audit event. Authority roles only.',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        complaintId: { type: 'string', minLength: 1 },
        newStatus: { type: 'string', minLength: 1 },
        notes: { type: 'string' },
        assignedTo: { type: 'string' }
      },
      required: ['complaintId', 'newStatus']
    }
  ),
  tool(
    'get_jurisdiction_analytics',
    'Fetch aggregated analytics for the caller jurisdiction. Authority roles only.',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        regionCodes: { type: 'array', items: { type: 'string' } },
        period: { type: 'string' },
        groupBy: { type: 'string', enum: ['district', 'zone', 'status'] }
      },
      required: ['regionCodes', 'period', 'groupBy']
    }
  ),
  tool(
    'assign_inspector',
    'Assign a field assignee for a complaint (implemented using the existing assignment table).',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        complaintId: { type: 'string', minLength: 1 },
        inspectorId: { type: 'string', minLength: 1 },
        notes: { type: 'string' }
      },
      required: ['complaintId', 'inspectorId']
    }
  ),
  tool(
    'upload_repair_proof',
    'Mark work as completed and attach repair proof metadata to the audit log.',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        complaintId: { type: 'string', minLength: 1 },
        mediaIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        workDescription: { type: 'string', minLength: 1 }
      },
      required: ['complaintId', 'mediaIds', 'workDescription']
    }
  )
];

function requireActor(actor: JwtClaims | undefined): JwtClaims {
  if (!actor) throw new Error('AUTH_REQUIRED');
  return actor;
}

function requireAuthorityRole(actor: JwtClaims, roles: Array<JwtClaims['role']>) {
  if (!roles.includes(actor.role)) throw new Error('FORBIDDEN');
}

async function updateComplaintStatus(params: {
  actor?: JwtClaims;
  complaintId: string;
  newStatus: string;
  notes?: string;
  assignedTo?: string;
}) {
  const actor = requireActor(params.actor);
  requireAuthorityRole(actor, ['CE', 'EE']);

  const complaint = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, fabric_txid FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.complaintId]
  );
  const row = complaint.rows[0];
  if (!row) throw new Error('NOT_FOUND');

  if (!assertDistrictAccess(actor as any, row.district) || !assertZoneAccess(actor as any, row.zone)) {
    throw new Error('FORBIDDEN');
  }

  await pool.query(`UPDATE complaints SET status = $2, updated_at = now() WHERE id = $1;`, [params.complaintId, params.newStatus]);

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_STATUS_CHANGED', 'complaint', $4, $5);`,
    [actor.sub, actor.phoneHash, actor.phone, params.complaintId, { from: row.status, to: params.newStatus, notes: params.notes ?? null, assignedTo: params.assignedTo ?? null }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_STATUS_CHANGED',
    actorUserId: actor.sub,
    complaintId: params.complaintId,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { from: row.status, to: params.newStatus, notes: params.notes ?? null, assignedTo: params.assignedTo ?? null }
  });

  const updated = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, updated_at, fabric_txid FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.complaintId]
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

  return { txId: (u.fabric_txid as string | null) ?? null, updatedAt: new Date(u.updated_at).toISOString() };
}

async function getJurisdictionAnalytics(params: {
  actor?: JwtClaims;
  regionCodes: string[];
  period: string;
  groupBy: 'district' | 'zone' | 'status';
}) {
  const actor = requireActor(params.actor);
  requireAuthorityRole(actor, ['CE', 'EE']);

  // Interpret regionCodes as district codes when provided; otherwise fall back to actor scope.
  const districts = params.regionCodes?.length ? params.regionCodes : actor.districts;

  // byStatus
  const where: string[] = [];
  const sqlParams: any[] = [];

  if (actor.role !== 'CE' && !actor.districts.includes('ALL')) {
    sqlParams.push(actor.districts);
    where.push(`district = ANY($${sqlParams.length}::text[])`);
  } else if (districts?.length && !districts.includes('ALL')) {
    // CE can request filtered districts.
    sqlParams.push(districts);
    where.push(`district = ANY($${sqlParams.length}::text[])`);
  }

  const byStatusRows = await pool.query(
    `SELECT status, count(*)::int as count FROM complaints ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY status;`,
    sqlParams
  );

  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows.rows) byStatus[r.status] = r.count;

  // budget utilization (same deterministic logic as /authority/budget)
  const pending = byStatus['PENDING'] ?? 0;
  const inProgress = byStatus['IN_PROGRESS'] ?? 0;
  const escalated = byStatus['ESCALATED'] ?? 0;

  const estimatedCommitted = pending * 25000 + inProgress * 10000 + escalated * 10000;
  const notResolved = Object.entries(byStatus)
    .filter(([status]) => status !== 'RESOLVED')
    .reduce((a, [, v]) => a + v, 0);
  const estimatedAvailable = Math.max(0, 25000 * Math.max(0, 100 - notResolved));

  // contractor performance (assignment counts)
  const perfWhere: string[] = [];
  const perfParams: any[] = [];
  if (where.length) {
    const first = where[0];
    if (first) perfWhere.push(first.replace(/district/g, 'c.district'));
    perfParams.push(...sqlParams);
  }

  const perfRows = await pool.query(
    `
      SELECT a.contractor_id as contractorId,
             coalesce(ct.name, a.contractor_id) as contractorName,
             count(*)::int as assignedCount,
             sum(case when c.status = 'RESOLVED' then 1 else 0 end)::int as resolvedCount,
             sum(case when c.status <> 'RESOLVED' then 1 else 0 end)::int as openCount
      FROM complaint_assignments a
      JOIN complaints c ON c.id = a.complaint_id
      LEFT JOIN contractors ct ON ct.id = a.contractor_id
      ${perfWhere.length ? `WHERE ${perfWhere.join(' AND ')}` : ''}
      GROUP BY a.contractor_id, ct.name
      ORDER BY assignedCount DESC
      LIMIT 25;
    `,
    perfParams
  );

  const groupBy = params.groupBy;

  return {
    period: params.period,
    groupBy,
    complaintTrends: {
      byStatus,
      totals: { total: Object.values(byStatus).reduce((a, b) => a + b, 0) }
    },
    budgetUtilization: {
      estimatedCommittedINR: estimatedCommitted,
      estimatedAvailableINR: estimatedAvailable
    },
    contractorPerformance: perfRows.rows
  };
}

async function assignInspector(params: {
  actor?: JwtClaims;
  complaintId: string;
  inspectorId: string;
  notes?: string;
}) {
  const actor = requireActor(params.actor);
  requireAuthorityRole(actor, ['CE', 'EE']);

  // NOTE: The gateway DB currently tracks contractor assignments (complaint_assignments).
  // This tool maps inspectorId -> contractor_id until a first-class inspector registry exists.

  const complaint = await pool.query(`SELECT id, district, zone, status, lat, lng, fabric_txid FROM complaints WHERE id = $1 LIMIT 1;`, [
    params.complaintId
  ]);
  const row = complaint.rows[0];
  if (!row) throw new Error('NOT_FOUND');

  if (!assertDistrictAccess(actor as any, row.district) || !assertZoneAccess(actor as any, row.zone)) {
    throw new Error('FORBIDDEN');
  }

  const contractor = await pool.query(`SELECT id FROM contractors WHERE id = $1 LIMIT 1;`, [params.inspectorId]);
  if (!contractor.rows[0]) throw new Error('UNKNOWN_ASSIGNEE');

  await pool.query(
    `INSERT INTO complaint_assignments (complaint_id, contractor_id, expected_resolution_days, assigned_by_user_id, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (complaint_id)
     DO UPDATE SET
       contractor_id = EXCLUDED.contractor_id,
       assigned_by_user_id = EXCLUDED.assigned_by_user_id,
       assigned_at = now(),
       notes = EXCLUDED.notes;`,
    [params.complaintId, params.inspectorId, null, actor.sub, params.notes ?? null]
  );

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'COMPLAINT_ASSIGNED', 'complaint', $4, $5);`,
    [actor.sub, actor.phoneHash, actor.phone, params.complaintId, { assigneeId: params.inspectorId, notes: params.notes ?? null }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_ASSIGNED',
    actorUserId: actor.sub,
    complaintId: params.complaintId,
    contractorId: params.inspectorId,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { notes: params.notes ?? null }
  });

  await createAndFanoutNotification({
    message: {
      type: 'assignment',
      title: `Complaint ${params.complaintId} assigned`,
      body: `Assigned to ${params.inspectorId} in ${row.district} / ${row.zone}.`,
      data: { complaintId: params.complaintId, district: row.district, zone: row.zone, assigneeId: params.inspectorId },
      audience: { kind: 'jurisdiction', district: row.district, zone: row.zone },
      critical: false
    }
  });

  return { assignmentId: params.complaintId, txId: (row.fabric_txid as string | null) ?? null };
}

async function uploadRepairProof(params: {
  actor?: JwtClaims;
  complaintId: string;
  mediaIds: string[];
  workDescription: string;
}) {
  const actor = requireActor(params.actor);
  requireAuthorityRole(actor, ['CE', 'EE']);

  const complaint = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, updated_at, fabric_txid FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.complaintId]
  );
  const row = complaint.rows[0];
  if (!row) throw new Error('NOT_FOUND');

  if (!assertDistrictAccess(actor as any, row.district) || !assertZoneAccess(actor as any, row.zone)) {
    throw new Error('FORBIDDEN');
  }

  // Mark resolved and record proof metadata in audit_log details.
  await pool.query(`UPDATE complaints SET status = 'RESOLVED', updated_at = now() WHERE id = $1;`, [params.complaintId]);

  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details)
     VALUES ($1, $2, $3, 'REPAIR_PROOF_UPLOADED', 'complaint', $4, $5);`,
    [actor.sub, actor.phoneHash, actor.phone, params.complaintId, { mediaIds: params.mediaIds, workDescription: params.workDescription }]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_RESOLVED',
    actorUserId: actor.sub,
    complaintId: params.complaintId,
    district: row.district,
    zone: row.zone,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    properties: { proofMediaIds: params.mediaIds, workDescription: params.workDescription }
  });

  const updated = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, updated_at, fabric_txid FROM complaints WHERE id = $1 LIMIT 1;`,
    [params.complaintId]
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
      data: { complaintId: u.id, district: u.district, zone: u.zone, status: u.status },
      audience: { kind: 'jurisdiction', district: u.district, zone: u.zone },
      critical: false
    }
  });

  // Gateway does not mint Fabric tx ids yet; surface any existing fabric_txid.
  return { resolutionTxId: (u.fabric_txid as string | null) ?? null, mediaCIDs: [] as string[] };
}

export async function executeAuthorityTool(params: {
  call: ToolCall;
  actor?: JwtClaims;
}): Promise<ChatMessage> {
  const { call, actor } = params;

  const name = call.name;
  const args = (call.arguments ?? {}) as any;

  try {
    let result: any;
    let source: any = { kind: 'gateway-db' };

    if (name === 'update_complaint_status') {
      result = await updateComplaintStatus({
        actor,
        complaintId: String(args.complaintId ?? ''),
        newStatus: String(args.newStatus ?? ''),
        notes: typeof args.notes === 'string' ? args.notes : undefined,
        assignedTo: typeof args.assignedTo === 'string' ? args.assignedTo : undefined
      });
      source = { kind: 'gateway-db', tables: ['complaints', 'audit_log', 'analytics_events'] };
    } else if (name === 'get_jurisdiction_analytics') {
      result = await getJurisdictionAnalytics({
        actor,
        regionCodes: Array.isArray(args.regionCodes) ? args.regionCodes.map(String) : [],
        period: String(args.period ?? ''),
        groupBy: (args.groupBy === 'district' || args.groupBy === 'zone' || args.groupBy === 'status') ? args.groupBy : 'status'
      });
      source = { kind: 'gateway-db', tables: ['complaints', 'complaint_assignments', 'contractors'], budget: 'estimated_from_local_rules' };
    } else if (name === 'assign_inspector') {
      result = await assignInspector({
        actor,
        complaintId: String(args.complaintId ?? ''),
        inspectorId: String(args.inspectorId ?? ''),
        notes: typeof args.notes === 'string' ? args.notes : undefined
      });
      source = { kind: 'gateway-db', tables: ['complaint_assignments', 'audit_log', 'analytics_events'] };
    } else if (name === 'upload_repair_proof') {
      result = await uploadRepairProof({
        actor,
        complaintId: String(args.complaintId ?? ''),
        mediaIds: Array.isArray(args.mediaIds) ? args.mediaIds.map(String) : [],
        workDescription: String(args.workDescription ?? '')
      });
      source = { kind: 'gateway-db', tables: ['complaints', 'audit_log', 'analytics_events'], media: 'metadata_only' };
    } else {
      throw new Error('UNKNOWN_TOOL');
    }

    return {
      role: 'tool',
      name,
      tool_call_id: call.id,
      content: JSON.stringify({ ok: true, source, result })
    };
  } catch (e) {
    const code = e instanceof Error ? e.message : 'ERROR';
    return {
      role: 'tool',
      name,
      tool_call_id: call.id,
      content: JSON.stringify({ ok: false, error: code })
    };
  }
}
