import { trackAnalyticsEvent } from '../../analytics/service.js';
import type { JwtClaims } from '../../auth/jwt.js';
import { createAndFanoutNotification } from '../../notifications/service.js';
import { pool } from '../../postgres.js'; // Migrated from execute wrapper to postgres.js instance
import { assertDistrictAccess, assertZoneAccess } from '../../rbac.js';
import { broadcastComplaintEvent } from '../../realtime/sse.js';
import { uuidv7 } from '../../uuid.js';
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

  const result = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, fabric_txid, updated_at 
     FROM complaints 
     WHERE id = $1 
     LIMIT 1`,
    [params.complaintId]
  );
  const complaint = result.rows[0];
  if (!complaint) throw new Error('NOT_FOUND');

  if (!assertDistrictAccess(actor as any, complaint.district) || !assertZoneAccess(actor as any, complaint.zone)) {
    throw new Error('FORBIDDEN');
  }

  let updatedComplaint;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(
      `UPDATE complaints 
       SET status = $1, updated_at = NOW() 
       WHERE id = $2`,
      [params.newStatus, params.complaintId]
    );

    await client.query(
      `INSERT INTO audit_log (
        actor_user_id, actor_phone_hash, actor_phone_masked, action, 
        target_type, target_id, details, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
          uuidv7(),
        actor.phoneHash, 
        actor.phone, 
        'COMPLAINT_STATUS_CHANGED', 
        'complaint', 
        params.complaintId, 
        JSON.stringify({ 
          from: complaint.status, 
          to: params.newStatus, 
          notes: params.notes ?? null, 
          assignedTo: params.assignedTo ?? null 
        })
      ]
    );

    await trackAnalyticsEvent({
      type: 'COMPLAINT_STATUS_CHANGED',
      actorUserId: actor.sub,
      complaintId: params.complaintId,
      district: complaint.district,
      zone: complaint.zone,
      lat: complaint.lat ?? null,
      lng: complaint.lng ?? null,
      properties: { 
        from: complaint.status, 
        to: params.newStatus, 
        notes: params.notes ?? null, 
        assignedTo: params.assignedTo ?? null 
      }
    });

    const updatedResult = await client.query(
      `SELECT id, district, zone, status, description, lat, lng, updated_at, fabric_txid 
       FROM complaints 
       WHERE id = $1 
       LIMIT 1`,
      [params.complaintId]
    );
    
    updatedComplaint = updatedResult.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (updatedComplaint) {
    broadcastComplaintEvent({
      type: 'complaint_updated',
      complaint: {
        id: updatedComplaint.id,
        district: updatedComplaint.district,
        zone: updatedComplaint.zone,
        status: updatedComplaint.status,
        description: updatedComplaint.description,
        lat: updatedComplaint.lat,
        lng: updatedComplaint.lng,
        updatedAt: new Date(updatedComplaint.updated_at).toISOString()
      }
    });

    await createAndFanoutNotification({
      message: {
        type: 'status_change',
        title: `Complaint ${updatedComplaint.id} status changed`,
        body: `Status updated to ${updatedComplaint.status} for a complaint in ${updatedComplaint.district} / ${updatedComplaint.zone}.`,
        data: { complaintId: updatedComplaint.id, district: updatedComplaint.district, zone: updatedComplaint.zone, status: updatedComplaint.status },
        audience: { kind: 'jurisdiction', district: updatedComplaint.district, zone: updatedComplaint.zone },
        critical: false
      }
    });
  }

  return { 
    txId: updatedComplaint ? (updatedComplaint.fabric_txid ?? null) : null, 
    updatedAt: updatedComplaint ? new Date(updatedComplaint.updated_at).toISOString() : new Date().toISOString() 
  };
}

async function getJurisdictionAnalytics(params: {
  actor?: JwtClaims;
  regionCodes: string[];
  period: string;
  groupBy: 'district' | 'zone' | 'status';
}) {
  const actor = requireActor(params.actor);
  requireAuthorityRole(actor, ['CE', 'EE']);

  let districts = params.regionCodes?.length ? params.regionCodes : actor.districts || [];
  const actorDistricts = actor.districts || [];

  // Enforce regional visibility boundaries
  if (actor.role !== 'CE' && !actorDistricts.includes('ALL')) {
    districts = districts.filter((d: string) => actorDistricts.includes(d));
    if (!districts.length && actorDistricts.length) {
      districts = actorDistricts;
    }
  }

  const byStatus: Record<string, number> = {};

  if (districts.length && !districts.includes('ALL')) {
    const res = await pool.query(
      `SELECT status FROM complaints WHERE district = ANY($1)`,
      [districts]
    );
    for (const r of res.rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    }
  } else {
    // Standard unmitigated grab for global accounts
    const res = await pool.query(`SELECT status FROM complaints`);
    for (const r of res.rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    }
  }

  const pending = byStatus['FILED'] ?? 0;
  const inProgress = byStatus['IN_PROGRESS'] ?? 0;
  const escalated = byStatus['ESCALATED'] ?? 0;

  const estimatedCommitted = pending * 25000 + inProgress * 10000 + escalated * 10000;
  const notResolved = Object.entries(byStatus)
    .filter(([status]) => status !== 'RESOLVED')
    .reduce((a, [, v]) => a + v, 0);
  const estimatedAvailable = Math.max(0, 25000 * Math.max(0, 100 - notResolved));

  const contractorMap: Record<string, { contractorName: string; assignedCount: number; resolvedCount: number; openCount: number }> = {};

  if (districts.length && !districts.includes('ALL')) {
    // Optimized single joined query instead of executing multi-layered loop queries
    const assignmentsRes = await pool.query(
      `SELECT a.contractor_id, a.complaint_id, c.status, co.name AS contractor_name
       FROM complaint_assignments a
       JOIN complaints c ON a.complaint_id = c.id
       LEFT JOIN contractors co ON a.contractor_id = co.id
       WHERE c.district = ANY($1)`,
      [districts]
    );

    for (const row of assignmentsRes.rows) {
      const cid = row.contractor_id;
      const cName = row.contractor_name ?? cid;
      
      contractorMap[cid] = contractorMap[cid] || { contractorName: cName, assignedCount: 0, resolvedCount: 0, openCount: 0 };
      contractorMap[cid].assignedCount += 1;
      
      if (row.status === 'RESOLVED') {
        contractorMap[cid].resolvedCount += 1;
      } else {
        contractorMap[cid].openCount += 1;
      }
    }
  }

  const perfRows = Object.entries(contractorMap).map(([contractorId, info]) => ({
    contractorId,
    contractorName: info.contractorName,
    assignedCount: info.assignedCount,
    resolvedCount: info.resolvedCount,
    openCount: info.openCount
  }));

  return {
    period: params.period,
    groupBy: params.groupBy,
    complaintTrends: {
      byStatus,
      totals: { total: Object.values(byStatus).reduce((a, b) => a + b, 0) }
    },
    budgetUtilization: {
      estimatedCommittedINR: estimatedCommitted,
      estimatedAvailableINR: estimatedAvailable
    },
    contractorPerformance: perfRows
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

  const complaintResult = await pool.query(
    `SELECT id, district, zone, status, lat, lng, fabric_txid, created_at 
     FROM complaints 
     WHERE id = $1 
     LIMIT 1`,
    [params.complaintId]
  );
  if (!complaintResult.rows.length) throw new Error('NOT_FOUND');
  const complaint = complaintResult.rows[0];

  if (!assertDistrictAccess(actor as any, complaint.district) || !assertZoneAccess(actor as any, complaint.zone)) {
    throw new Error('FORBIDDEN');
  }

  const contractorResult = await pool.query(
    `SELECT id FROM contractors WHERE id = $1 LIMIT 1`,
    [params.inspectorId]
  );
  if (!contractorResult.rows.length) throw new Error('UNKNOWN_ASSIGNEE');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(
      `INSERT INTO complaint_assignments (
        complaint_id, contractor_id, expected_resolution_days, assigned_by_user_id, notes, assigned_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (complaint_id) DO UPDATE
        SET contractor_id = EXCLUDED.contractor_id,
            notes         = EXCLUDED.notes,
            assigned_at   = NOW()`,
      [params.complaintId, params.inspectorId, null, actor.sub, params.notes ?? null]
    );

    await client.query(
      `INSERT INTO audit_log (
        actor_user_id, actor_phone_hash, actor_phone_masked, action, 
        target_type, target_id, details, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
          uuidv7(),
        actor.phoneHash, 
        actor.phone, 
        'COMPLAINT_ASSIGNED', 
        'complaint', 
        params.complaintId, 
        JSON.stringify({ assigneeId: params.inspectorId, notes: params.notes ?? null })
      ]
    );
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await trackAnalyticsEvent({
    type: 'COMPLAINT_ASSIGNED',
    actorUserId: actor.sub,
    complaintId: params.complaintId,
    contractorId: params.inspectorId,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { notes: params.notes ?? null }
  });

  await createAndFanoutNotification({
    message: {
      type: 'assignment',
      title: `Complaint ${params.complaintId} assigned`,
      body: `Assigned to ${params.inspectorId} in ${complaint.district} / ${complaint.zone}.`,
      data: { complaintId: params.complaintId, district: complaint.district, zone: complaint.zone, assigneeId: params.inspectorId },
      audience: { kind: 'jurisdiction', district: complaint.district, zone: complaint.zone },
      critical: false
    }
  });

  return { 
    assignmentId: params.complaintId, 
    txId: complaint.fabric_txid ?? null 
  };
}

async function uploadRepairProof(params: {
  actor?: JwtClaims;
  complaintId: string;
  mediaIds: string[];
  workDescription: string;
}) {
  const actor = requireActor(params.actor);
  requireAuthorityRole(actor, ['CE', 'EE']);

  const complaintResult = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, updated_at, fabric_txid 
     FROM complaints 
     WHERE id = $1 
     LIMIT 1`,
    [params.complaintId]
  );
  if (!complaintResult.rows.length) throw new Error('NOT_FOUND');
  const complaint = complaintResult.rows[0];

  if (!assertDistrictAccess(actor as any, complaint.district) || !assertZoneAccess(actor as any, complaint.zone)) {
    throw new Error('FORBIDDEN');
  }

  let updatedComplaint;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(
      `UPDATE complaints 
       SET status = 'RESOLVED', updated_at = NOW() 
       WHERE id = $1`,
      [params.complaintId]
    );

    await client.query(
      `INSERT INTO audit_log (
        actor_user_id, actor_phone_hash, actor_phone_masked, action, 
        target_type, target_id, details, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
          uuidv7(),
        actor.phoneHash, 
        actor.phone, 
        'REPAIR_PROOF_UPLOADED', 
        'complaint', 
        params.complaintId, 
        JSON.stringify({ mediaIds: params.mediaIds, workDescription: params.workDescription })
      ]
    );

    await trackAnalyticsEvent({
      type: 'COMPLAINT_RESOLVED',
      actorUserId: actor.sub,
      complaintId: params.complaintId,
      district: complaint.district,
      zone: complaint.zone,
      lat: complaint.lat ?? null,
      lng: complaint.lng ?? null,
      properties: { proofMediaIds: params.mediaIds, workDescription: params.workDescription }
    });

    const updatedResult = await client.query(
      `SELECT id, district, zone, status, description, lat, lng, updated_at, fabric_txid 
       FROM complaints 
       WHERE id = $1 
       LIMIT 1`,
      [params.complaintId]
    );
    
    updatedComplaint = updatedResult.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (updatedComplaint) {
    broadcastComplaintEvent({
      type: 'complaint_resolved',
      complaint: {
        id: updatedComplaint.id,
        district: updatedComplaint.district,
        zone: updatedComplaint.zone,
        status: updatedComplaint.status,
        description: updatedComplaint.description,
        lat: updatedComplaint.lat,
        lng: updatedComplaint.lng,
        updatedAt: new Date(updatedComplaint.updated_at).toISOString()
      }
    });

    await createAndFanoutNotification({
      message: {
        type: 'resolved',
        title: `Complaint ${updatedComplaint.id} resolved`,
        body: `A complaint in ${updatedComplaint.district} / ${updatedComplaint.zone} was marked RESOLVED.`,
        data: { complaintId: updatedComplaint.id, district: updatedComplaint.district, zone: updatedComplaint.zone, status: updatedComplaint.status },
        audience: { kind: 'jurisdiction', district: updatedComplaint.district, zone: updatedComplaint.zone },
        critical: false
      }
    });
  }

  return { 
    resolutionTxId: updatedComplaint ? (updatedComplaint.fabric_txid ?? null) : null, 
    mediaCIDs: [] as string[] 
  };
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