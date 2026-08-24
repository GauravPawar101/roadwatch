import express from 'express';
import { z } from 'zod';
import { countryAdapter, RoadType, Severity, ComplaintStatus, mapIndianRoadToDomainType } from '@roadwatch/adapters';
import { trackAnalyticsEvent } from '../analytics/service.js';
import { buildRequestHash, claimIdempotency, deriveIdempotencyKey, storeIdempotencyResult } from '../idempotency.js';
import { createAndFanoutNotification } from '../notifications/service.js';
import { pool } from '../postgres.js';
import { requireAuth, type AuthedRequest } from '../rbac.js';
import { broadcastComplaintEvent } from '../realtime/sse.js';
import {
  awardValidSubmissionKarma,
  ensureSlaTracking,
  applyRecurrenceKarmaPenalties,
  haversineMeters,
  RECURRENCE_RADIUS_M,
  slaHoursForRoadType,
} from '../services/complaint-lifecycle.js';
import { bumpComplaintReadCache, readCachedJson, writeCachedJson } from '@roadwatch/redis';
import { maybeSyncAnchorComplaint } from '../services/sync-anchor.js';
import { uuidv7 } from '../uuid.js';

const router = express.Router();

function mergeEscalationWindowMs(roadId: string): number {
  return slaHoursForRoadType(roadId) * 60 * 60 * 1000;
}

// Validation schemas
const complaintSchema = z.object({
  roadId: z.string().min(1),
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  damageType: z.enum(['Potholes & Roads', 'Street Lighting', 'Water & Sewage', 'Waste Management', 'Signage']),
  severity: z.number().int().min(1).max(5),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  capturedLat: z.number().min(-90).max(90).optional(),
  capturedLng: z.number().min(-180).max(180).optional(),
  capturedAt: z.string().datetime().optional(),
  imageCid: z.string().optional(),
  imageSha256: z.string().optional(),
  imageMime: z.string().optional()
});

const querySchema = z.object({
  bounds: z.string().optional(), // "lat1,lng1,lat2,lng2"
  severity: z.string().optional(), // "1,2,3,4,5"
  status: z.string().optional(), // "Open,InProgress,Resolved"
  damageType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

type ComplaintMergeCandidate = {
  id: string;
  status: string;
  report_count: number;
  created_at: Date | string;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
};

const COMPLAINT_STATUS_ALIASES: Record<string, string[]> = {
  Open: ['Open', 'FILED'],
  InProgress: ['InProgress', 'IN_PROGRESS'],
  Resolved: ['Resolved', 'RESOLVED'],
  Dismissed: ['Dismissed', 'DISMISSED'],
  Escalated: ['Escalated', 'ESCALATED']
};

function normalizeComplaintStatus(status: string | null | undefined): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'FILED':
    case 'OPEN':
      return 'Open';
    case 'IN_PROGRESS':
    case 'INPROGRESS':
      return 'InProgress';
    case 'RESOLVED':
      return 'Resolved';
    case 'DISMISSED':
      return 'Dismissed';
    case 'ESCALATED':
      return 'Escalated';
    default:
      return String(status ?? '');
  }
}

function expandComplaintStatuses(input: string): string[] {
  const statuses = input
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean)
    .flatMap((status) => COMPLAINT_STATUS_ALIASES[status] ?? [status]);

  return [...new Set(statuses)];
}

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

async function writeAuditEntry(input: {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (
       id, actor_user_id, actor_phone_hash, actor_phone_masked,
       action, target_type, target_id, details, created_at
     ) VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, NOW())`,
    [
      uuidv7(),
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      JSON.stringify(input.details)
    ]
  );
}

async function loadComplaintSummary(complaintId: string) {
  const result = await pool.query(
    `SELECT id, district, zone, status, description, lat, lng, metadata, report_count, created_at, updated_at
     FROM complaints
     WHERE id = $1
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
        metadata: Record<string, unknown> | null;
        report_count: number;
        created_at: Date;
        updated_at: Date;
      }
    | undefined;
}

function canCitizenAccessComplaint(user: { role: string; sub: string }, complaint: { metadata: Record<string, unknown> | null }) {
  if (user.role !== 'CITIZEN') return true;
  return complaint.metadata?.authorId === user.sub || complaint.metadata?.public === 'true';
}

// GET /complaints - List complaints with filtering and geospatial queries
router.get('/', requireAuth, async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const user = (req as AuthedRequest).user;
    const cacheParts = {
      route: 'list',
      query,
      role: user.role,
      sub: user.sub,
      districts: user.districts ?? []
    };
    const cached = await readCachedJson<{ complaints: unknown; pagination: unknown }>(
      'complaints-list',
      cacheParts
    );
    if (cached) {
      return res.json(cached);
    }

    let sql = `
      SELECT 
        c.id,
        c.road_id,
        c.status,
        c.description,
        c.lat,
        c.lng,
        c.district,
        c.zone,
        c.report_count,
        c.created_at,
        c.updated_at,
        c.metadata,
        COALESCE(
          array_agg(
            CASE WHEN ca.id IS NOT NULL THEN
              json_build_object(
                'id', ca.id,
                'kind', ca.kind,
                'file_path', ca.file_path,
                'file_mime', ca.file_mime
              )
            END
          ) FILTER (WHERE ca.id IS NOT NULL), 
          '{}'
        ) as attachments
      FROM complaints c
      LEFT JOIN complaint_attachments ca ON c.id = ca.complaint_id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Geospatial filtering
    if (query.bounds) {
      const [lat1, lng1, lat2, lng2] = query.bounds.split(',').map(Number);
      if ([lat1, lng1, lat2, lng2].every(Number.isFinite)) {
        const safeLat1 = lat1 as number;
        const safeLng1 = lng1 as number;
        const safeLat2 = lat2 as number;
        const safeLng2 = lng2 as number;
        sql += ` AND c.lat BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        sql += ` AND c.lng BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}`;
        params.push(Math.min(safeLat1, safeLat2), Math.max(safeLat1, safeLat2), Math.min(safeLng1, safeLng2), Math.max(safeLng1, safeLng2));
        paramIndex += 4;
      }
    }

    // Severity filtering
    if (query.severity) {
      const severities = query.severity.split(',').map(Number).filter(n => n >= 1 && n <= 5);
      if (severities.length > 0) {
        sql += ` AND (c.metadata->>'severity')::int = ANY($${paramIndex})`;
        params.push(severities);
        paramIndex++;
      }
    }

    // Status filtering
    if (query.status) {
      const statuses = expandComplaintStatuses(query.status).filter((status) =>
        ['Open', 'FILED', 'InProgress', 'IN_PROGRESS', 'Resolved', 'RESOLVED', 'Dismissed', 'DISMISSED', 'Escalated', 'ESCALATED'].includes(status)
      );
      if (statuses.length > 0) {
        sql += ` AND c.status = ANY($${paramIndex})`;
        params.push(statuses);
        paramIndex++;
      }
    }

    // Damage type filtering
    if (query.damageType) {
      sql += ` AND c.metadata->>'damageType' = $${paramIndex}`;
      params.push(query.damageType);
      paramIndex++;
    }

    // Role-based filtering
    if (user.role === 'CITIZEN') {
      // Citizens can only see their own complaints and public ones
      sql += ` AND (c.metadata->>'authorId' = $${paramIndex} OR c.metadata->>'public' = 'true')`;
      params.push(user.sub);
      paramIndex++;
    } else if (user.role === 'CE' || user.role === 'EE') {
      // Authorities can see complaints in their jurisdiction
      if (user.districts && user.districts.length > 0) {
        sql += ` AND c.district = ANY($${paramIndex})`;
        params.push(user.districts);
        paramIndex++;
      }
    }

    let countSql = `
      SELECT COUNT(DISTINCT c.id)::int AS count
      FROM complaints c
      LEFT JOIN complaint_attachments ca ON c.id = ca.complaint_id
      WHERE 1=1
    `;
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (query.bounds) {
      const [lat1, lng1, lat2, lng2] = query.bounds.split(',').map(Number);
      if ([lat1, lng1, lat2, lng2].every(Number.isFinite)) {
        const safeLat1 = lat1 as number;
        const safeLng1 = lng1 as number;
        const safeLat2 = lat2 as number;
        const safeLng2 = lng2 as number;
        countSql += ` AND c.lat BETWEEN $${countParamIndex} AND $${countParamIndex + 1}`;
        countSql += ` AND c.lng BETWEEN $${countParamIndex + 2} AND $${countParamIndex + 3}`;
        countParams.push(Math.min(safeLat1, safeLat2), Math.max(safeLat1, safeLat2), Math.min(safeLng1, safeLng2), Math.max(safeLng1, safeLng2));
        countParamIndex += 4;
      }
    }

    if (query.severity) {
      const severities = query.severity.split(',').map(Number).filter(n => n >= 1 && n <= 5);
      if (severities.length > 0) {
        countSql += ` AND (c.metadata->>'severity')::int = ANY($${countParamIndex})`;
        countParams.push(severities);
        countParamIndex++;
      }
    }

    if (query.status) {
      const statuses = expandComplaintStatuses(query.status).filter((status) =>
        ['Open', 'FILED', 'InProgress', 'IN_PROGRESS', 'Resolved', 'RESOLVED', 'Dismissed', 'DISMISSED', 'Escalated', 'ESCALATED'].includes(status)
      );
      if (statuses.length > 0) {
        countSql += ` AND c.status = ANY($${countParamIndex})`;
        countParams.push(statuses);
        countParamIndex++;
      }
    }

    if (query.damageType) {
      countSql += ` AND c.metadata->>'damageType' = $${countParamIndex}`;
      countParams.push(query.damageType);
      countParamIndex++;
    }

    if (user.role === 'CITIZEN') {
      countSql += ` AND (c.metadata->>'authorId' = $${countParamIndex} OR c.metadata->>'public' = 'true')`;
      countParams.push(user.sub);
      countParamIndex++;
    } else if (user.role === 'CE' || user.role === 'EE') {
      if (user.districts && user.districts.length > 0) {
        countSql += ` AND c.district = ANY($${countParamIndex})`;
        countParams.push(user.districts);
        countParamIndex++;
      }
    }

    const countResult = await pool.query(countSql, countParams);
    const totalCount = Number(countResult.rows[0]?.count ?? 0);

    sql += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(query.limit, query.offset);

    const result = await pool.query(sql, params);

    // Transform the data
    const complaints = result.rows.map(row => ({
      id: row.id,
      roadId: row.road_id,
      status: normalizeComplaintStatus(row.status),
      title: row.metadata?.title || 'Untitled Complaint',
      description: row.description,
      damageType: row.metadata?.damageType || 'Unknown',
      severity: parseInt(row.metadata?.severity || '3'),
      lat: parseFloat(row.lat),
      lng: parseFloat(row.lng),
      district: row.district,
      zone: row.zone,
      reportCount: row.report_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attachments: row.attachments || []
    }));

    const payload = {
      complaints,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total: totalCount
      }
    };
    await writeCachedJson('complaints-list', cacheParts, payload);
    res.json(payload);

  } catch (error) {
    console.error('Failed to fetch complaints:', error);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

// GET /complaints/:id - Get specific complaint details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const complaintId = req.params.id;
    const user = (req as AuthedRequest).user;

    const result = await pool.query(`
      SELECT 
        c.*,
        COALESCE(
          array_agg(
            CASE WHEN ca.id IS NOT NULL THEN
              json_build_object(
                'id', ca.id,
                'kind', ca.kind,
                'file_path', ca.file_path,
                'file_mime', ca.file_mime,
                'file_sha256', ca.file_sha256,
                'created_at', ca.created_at
              )
            END
          ) FILTER (WHERE ca.id IS NOT NULL), 
          '{}'
        ) as attachments
      FROM complaints c
      LEFT JOIN complaint_attachments ca ON c.id = ca.complaint_id
      WHERE c.id = $1
      GROUP BY c.id
    `, [complaintId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const complaint = result.rows[0];

    // Check access permissions
    if (user.role === 'CITIZEN' && 
        complaint.metadata?.authorId !== user.sub && 
        complaint.metadata?.public !== 'true') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      id: complaint.id,
      roadId: complaint.road_id,
      status: normalizeComplaintStatus(complaint.status),
      title: complaint.metadata?.title || 'Untitled Complaint',
      description: complaint.description,
      damageType: complaint.metadata?.damageType || 'Unknown',
      severity: parseInt(complaint.metadata?.severity || '3'),
      lat: parseFloat(complaint.lat),
      lng: parseFloat(complaint.lng),
      district: complaint.district,
      zone: complaint.zone,
      reportCount: complaint.report_count,
      createdAt: complaint.created_at,
      updatedAt: complaint.updated_at,
      attachments: complaint.attachments || [],
      metadata: complaint.metadata
    });

  } catch (error) {
    console.error('Failed to fetch complaint:', error);
    res.status(500).json({ error: 'Failed to fetch complaint' });
  }
});

// POST /complaints - Create new complaint
router.post('/', requireAuth, async (req, res) => {
  try {
    const data = complaintSchema.parse(req.body);
    const user = (req as AuthedRequest).user;

    const idempotencyKey = deriveIdempotencyKey(req, 'complaints:create');
    const requestHash = buildRequestHash({ userId: user.sub, data });
    const claimed = await claimIdempotency('complaints:create', idempotencyKey, requestHash);
    if ('replay' in claimed) {
      return res.status(claimed.statusCode).json(claimed.body as any);
    }

    const complaintId = uuidv7();

    const client = await pool.connect();
    let existingComplaintId: string | null = null;
    let reused = false;
    let escalated = false;
    let reassigned = false;
    let reportCount = 1;
    let finalStatus = 'Open';
    let finalSeverity = data.severity;
    let mergeReason: string | null = null;

    try {
      await client.query('BEGIN');

      const lockKey = `${data.roadId}:${data.damageType}:${Math.round(data.lat * 1000)}:${Math.round(data.lng * 1000)}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

      const activeResult = await client.query(
        `SELECT id, status, report_count, created_at, updated_at, metadata
         FROM complaints
         WHERE road_id = $1
           AND metadata->>'damageType' = $2
           AND UPPER(status) IN ('OPEN', 'INPROGRESS', 'ESCALATED')
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [data.roadId, data.damageType]
      );

      let existing: ComplaintMergeCandidate | undefined = activeResult.rows[0];
      const MERGE_ESCALATION_WINDOW_MS = mergeEscalationWindowMs(data.roadId);

      if (!existing) {
        const resolvedLookbackHours = Math.max(24, Math.ceil(MERGE_ESCALATION_WINDOW_MS / (60 * 60 * 1000)));
        const resolvedResult = await client.query(
          `SELECT id, status, report_count, created_at, updated_at, metadata, lat, lng
           FROM complaints
           WHERE road_id = $1
             AND metadata->>'damageType' = $2
             AND UPPER(status) IN ('RESOLVED', 'RESOLUTION_SUBMITTED')
             AND updated_at >= NOW() - ($3::text || ' hours')::interval
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 5
           FOR UPDATE`,
          [data.roadId, data.damageType, String(resolvedLookbackHours)]
        );
        // Prefer a prior complaint within 100m of this report
        existing = resolvedResult.rows.find((row: any) => {
          if (row.lat == null || row.lng == null) return true;
          return haversineMeters(
            { lat: Number(row.lat), lng: Number(row.lng) },
            { lat: data.lat, lng: data.lng }
          ) <= RECURRENCE_RADIUS_M;
        });
      }

      if (existing) {
        existingComplaintId = String(existing.id);
        reused = true;
        reportCount = Number(existing.report_count ?? 1) + 1;

        const isResolvedRecurrence = ['RESOLVED', 'RESOLUTION_SUBMITTED', 'Resolved'].includes(String(existing.status));
        const ageMs = isResolvedRecurrence
          ? Date.now() - new Date(existing.updated_at).getTime()
          : Date.now() - new Date(existing.created_at).getTime();
        const shouldEscalate = isResolvedRecurrence
          ? ageMs <= MERGE_ESCALATION_WINDOW_MS
          : ageMs >= MERGE_ESCALATION_WINDOW_MS;

        finalSeverity = getComplaintSeverity(existing.metadata, data.severity);
        if (shouldEscalate) {
          escalated = true;
          // Use adapter escalation path to confirm ESCALATED is a valid next status
          const escalationPath = countryAdapter.getEscalationPath(
            isResolvedRecurrence ? ComplaintStatus.RESOLVED : ComplaintStatus.IN_PROGRESS
          );
          const nextStatus = escalationPath.includes(ComplaintStatus.ESCALATED)
            ? 'Escalated'
            : finalStatus;
          finalStatus = nextStatus;
          // Severity bump: recurrence after resolution is more severe (+2), active recurrence is +1
          finalSeverity = Math.min(finalSeverity + (isResolvedRecurrence ? 2 : 1), 5);
          mergeReason = isResolvedRecurrence ? 'resolved-within-sla-window' : 'active-past-sla-window';
        } else {
          finalStatus = existing.status;
          mergeReason = 'same-road-same-type-merge';
        }

        const updatedMetadata = toComplaintMetadata(existing.metadata, {
          title: data.title,
          damageType: data.damageType,
          severity: finalSeverity,
          mergedAt: new Date().toISOString(),
          escalationReason: mergeReason,
          escalationLevel: escalated ? (isResolvedRecurrence ? 2 : 1) : Number(existing.metadata?.escalationLevel ?? 0),
          escalatedAt: escalated ? new Date().toISOString() : existing.metadata?.escalatedAt ?? null,
          public: existing.metadata?.public ?? true,
          authorId: existing.metadata?.authorId ?? user.sub,
          authorRole: existing.metadata?.authorRole ?? user.role,
          capturedLat: data.capturedLat ?? existing.metadata?.capturedLat ?? null,
          capturedLng: data.capturedLng ?? existing.metadata?.capturedLng ?? null,
          capturedAt: data.capturedAt ?? existing.metadata?.capturedAt ?? null
        });

        const updated = await client.query(
          `UPDATE complaints
           SET report_count = report_count + 1,
               status       = $2,
               updated_at   = NOW(),
               metadata     = $3
           WHERE id = $1
           RETURNING report_count`,
          [existingComplaintId, finalStatus, updatedMetadata]
        );
        reportCount = Number(updated.rows[0]?.report_count ?? reportCount);

        if (escalated) {
          const roadAssignmentRes = await client.query(
            `SELECT contractor_id, engineer_user_id
             FROM road_assignments
             WHERE road_id = $1
             ORDER BY assigned_at DESC
             LIMIT 1`,
            [data.roadId]
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
              [existingComplaintId, roadAssignment.contractor_id, 1, null, 'auto-reassigned after recurrence escalation']
            );
            reassigned = true;
          }

          if (roadAssignment?.engineer_user_id) {
            await writeAuditEntry({
              actorUserId: roadAssignment.engineer_user_id,
              action: 'SLA_WARNING',
              targetType: 'complaint',
              targetId: existingComplaintId,
              details: {
                roadId: data.roadId,
                damageType: data.damageType,
                escalationReason: mergeReason,
                severity: finalSeverity
              }
            });
          }
        }
      } else {
        existingComplaintId = complaintId;
        reportCount = 1;
        finalStatus = 'Open';
        finalSeverity = data.severity;

        const metadata = {
          title: data.title,
          damageType: data.damageType,
          severity: data.severity,
          authorId: user.sub,
          authorRole: user.role,
          capturedLat: data.capturedLat,
          capturedLng: data.capturedLng,
          capturedAt: data.capturedAt,
          public: true
        };

        await client.query(
          `INSERT INTO complaints (
             id, road_id, status, description, lat, lng,
             district, zone, metadata, user_id, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
          [
            complaintId,
            data.roadId,
            'Open',
            data.description,
            data.lat,
            data.lng,
            user.districts?.[0] || 'Unknown',
            user.zones?.[0] || 'Unknown',
            JSON.stringify(metadata),
            user.sub
          ]
        );

        if (data.imageCid) {
          await client.query(
            `INSERT INTO complaint_attachments (
               complaint_id, kind, file_path, file_mime, file_sha256, created_at
             ) VALUES ($1, $2, $3, $4, $5, NOW())`,
            [
              complaintId,
              'PHOTO',
              data.imageCid,
              data.imageMime || 'image/jpeg',
              data.imageSha256
            ]
          );
        }
      }

      await writeAuditEntry({
        actorUserId: user.sub,
        action: escalated ? 'COMPLAINT_ESCALATED' : reused ? 'COMPLAINT_MERGED' : 'COMPLAINT_CREATED',
        targetType: 'complaint',
        targetId: existingComplaintId,
        details: {
          district: user.districts?.[0] || 'Unknown',
          zone: user.zones?.[0] || 'Unknown',
          roadId: data.roadId,
          damageType: data.damageType,
          reportCount,
          merged: reused,
          escalated,
          reassigned,
          mergeReason,
          severity: finalSeverity
        }
      });

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    if (escalated) {
      await trackAnalyticsEvent({
        type: 'COMPLAINT_ESCALATED',
        actorUserId: user.sub,
        complaintId: existingComplaintId,
        district: user.districts?.[0] || 'Unknown',
        zone: user.zones?.[0] || 'Unknown',
        lat: data.lat,
        lng: data.lng,
        properties: {
          roadId: data.roadId,
          damageType: data.damageType,
          severity: finalSeverity,
          merged: reused,
          reassigned,
          mergeReason
        }
      });
    }

    if (!reused && existingComplaintId) {
      await ensureSlaTracking(existingComplaintId, { severity: finalSeverity, roadType: data.roadId });
    } else if (escalated && existingComplaintId) {
      await ensureSlaTracking(existingComplaintId, {
        severity: finalSeverity,
        roadType: data.roadId,
        deadline: new Date(Date.now() + mergeEscalationWindowMs(data.roadId) / 2),
      });
    }
    if (existingComplaintId) {
      await awardValidSubmissionKarma(user.sub, existingComplaintId).catch(() => null);
    }

    // Dual karma when same-road / 100m recurrence after complete/resolve
    if (reused && existingComplaintId && mergeReason === 'resolved-within-sla-window') {
      await applyRecurrenceKarmaPenalties({
        complaintId: existingComplaintId,
        roadId: data.roadId,
        withinOriginalSla: true,
      }).catch((err) => console.warn('[complaints] recurrence karma failed:', err));
    }

    const responseBody = {
      id: existingComplaintId,
      message: escalated
        ? 'Complaint merged and escalated'
        : reused
          ? 'Added to existing complaint'
          : 'New complaint created',
      complaint: {
        id: existingComplaintId,
        status: finalStatus,
        severity: finalSeverity,
        reportCount,
        merged: reused,
        escalated,
        reassigned
      }
    };

    await storeIdempotencyResult(claimed, 201, responseBody);
    await bumpComplaintReadCache();
    await maybeSyncAnchorComplaint({
      complaintId: String(existingComplaintId),
      citizenId: user.sub,
      roadId: data.roadId,
      lat: data.lat,
      lng: data.lng,
      merged: reused,
      reportCount
    });

    res.status(201).json(responseBody);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Failed to create complaint:', error);
    res.status(500).json({ error: 'Failed to create complaint' });
  }
});

// GET /complaints/heatmap - Get heatmap data
router.get('/heatmap/data', requireAuth, async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const cacheParts = { route: 'heatmap', query };
    const cached = await readCachedJson<{ heatmapData: unknown[] }>('complaints-heatmap', cacheParts);
    if (cached) {
      return res.json(cached);
    }

    let sql = `
      SELECT 
        lat,
        lng,
        (metadata->>'severity')::int as severity,
        status,
        metadata->>'damageType' as damage_type,
        COUNT(*) as complaint_count
      FROM complaints 
      WHERE lat IS NOT NULL AND lng IS NOT NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Apply same filters as regular complaints endpoint
    if (query.bounds) {
      const [lat1, lng1, lat2, lng2] = query.bounds.split(',').map(Number);
      if ([lat1, lng1, lat2, lng2].every(Number.isFinite)) {
        const safeLat1 = lat1 as number;
        const safeLng1 = lng1 as number;
        const safeLat2 = lat2 as number;
        const safeLng2 = lng2 as number;
        sql += ` AND lat BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        sql += ` AND lng BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}`;
        params.push(Math.min(safeLat1, safeLat2), Math.max(safeLat1, safeLat2), Math.min(safeLng1, safeLng2), Math.max(safeLng1, safeLng2));
        paramIndex += 4;
      }
    }

    if (query.status) {
      const statuses = expandComplaintStatuses(query.status).filter((status) =>
        ['Open', 'FILED', 'InProgress', 'IN_PROGRESS', 'Resolved', 'RESOLVED', 'Dismissed', 'DISMISSED', 'Escalated', 'ESCALATED'].includes(status)
      );
      if (statuses.length > 0) {
        sql += ` AND status = ANY($${paramIndex})`;
        params.push(statuses);
        paramIndex++;
      }
    }

    sql += ` GROUP BY lat, lng, (metadata->>'severity')::int, status, metadata->>'damageType' ORDER BY complaint_count DESC`;

    const result = await pool.query(sql, params);

    const payload = {
      heatmapData: result.rows.map(row => ({
        lat: parseFloat(row.lat),
        lng: parseFloat(row.lng),
        severity: row.severity || 3,
        status: normalizeComplaintStatus(row.status),
        damageType: row.damage_type,
        count: parseInt(row.complaint_count)
      }))
    };
    await writeCachedJson('complaints-heatmap', cacheParts, payload);
    res.json(payload);

  } catch (error) {
    console.error('Failed to fetch heatmap data:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

router.get('/:id/comments', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional().default(100) }).parse(req.query);

  const complaint = await loadComplaintSummary(params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (!canCitizenAccessComplaint(user as any, complaint)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const comments = await pool.query(
    `SELECT cc.id, cc.parent_id, cc.body, cc.user_id, cc.user_role, cc.created_at, cc.updated_at, u.username
     FROM complaint_comments cc
     LEFT JOIN users u ON u.id = cc.user_id
     WHERE cc.complaint_id = $1
     ORDER BY cc.created_at ASC
     LIMIT $2`,
    [params.id, query.limit]
  );

  res.json({
    comments: comments.rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id ?? null,
      body: row.body,
      userId: row.user_id,
      userRole: row.user_role,
      username: row.username ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  });
});

router.post('/:id/comments', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ body: z.string().min(1).max(2000), parentId: z.string().uuid().optional() }).parse(req.body);

  const complaint = await loadComplaintSummary(params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (!canCitizenAccessComplaint(user as any, complaint)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const commentId = uuidv7();
  await pool.query(
    `INSERT INTO complaint_comments (id, complaint_id, user_id, user_role, parent_id, body, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [commentId, params.id, user.sub, user.role, body.parentId ?? null, body.body]
  );

  await pool.query(`UPDATE complaints SET updated_at = NOW() WHERE id = $1`, [params.id]);

  await writeAuditEntry({
    actorUserId: user.sub,
    action: 'COMPLAINT_COMMENTED',
    targetType: 'complaint',
    targetId: params.id,
    details: { parentId: body.parentId ?? null }
  });

  await trackAnalyticsEvent({
    type: 'COMPLAINT_COMMENTED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { parentId: body.parentId ?? null }
  });

  broadcastComplaintEvent({
    type: 'complaint_updated',
    complaint: {
      id: complaint.id,
      district: complaint.district,
      zone: complaint.zone,
      status: complaint.status,
      description: complaint.description,
      lat: complaint.lat,
      lng: complaint.lng,
      updatedAt: new Date().toISOString()
    }
  });

  await createAndFanoutNotification({
    message: {
      type: 'status_change',
      title: `New comment on complaint ${params.id}`,
      body: body.body,
      data: { complaintId: params.id, commentId, parentId: body.parentId ?? null },
      audience: { kind: 'jurisdiction', district: complaint.district, zone: complaint.zone },
      critical: false
    }
  });

  res.status(201).json({
    ok: true,
    comment: {
      id: commentId,
      complaintId: params.id,
      parentId: body.parentId ?? null,
      body: body.body,
      userId: user.sub,
      userRole: user.role,
      createdAt: new Date().toISOString()
    }
  });
});

router.post('/:id/reactions', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const params = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({ reaction: z.enum(['UPVOTE', 'FLAG']) }).parse(req.body);

  const complaint = await loadComplaintSummary(params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (!canCitizenAccessComplaint(user as any, complaint)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  await pool.query(
    `INSERT INTO complaint_reactions (id, complaint_id, user_id, reaction, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (complaint_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = NOW()`,
    [uuidv7(), params.id, user.sub, body.reaction]
  );

  await pool.query(`UPDATE complaints SET updated_at = NOW() WHERE id = $1`, [params.id]);

  const countsResult = await pool.query(
    `SELECT reaction, COUNT(*)::int AS count
     FROM complaint_reactions
     WHERE complaint_id = $1
     GROUP BY reaction`,
    [params.id]
  );

  const counts = countsResult.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.reaction] = row.count;
    return acc;
  }, {});

  await writeAuditEntry({
    actorUserId: user.sub,
    action: body.reaction === 'FLAG' ? 'COMPLAINT_FLAGGED' : 'COMPLAINT_UPVOTED',
    targetType: 'complaint',
    targetId: params.id,
    details: { reaction: body.reaction }
  });

  await trackAnalyticsEvent({
    type: body.reaction === 'FLAG' ? 'COMPLAINT_FLAGGED' : 'COMPLAINT_UPVOTED',
    actorUserId: user.sub,
    complaintId: params.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat ?? null,
    lng: complaint.lng ?? null,
    properties: { reaction: body.reaction }
  });

  if (body.reaction === 'FLAG') {
    broadcastComplaintEvent({
      type: 'complaint_updated',
      complaint: {
        id: complaint.id,
        district: complaint.district,
        zone: complaint.zone,
        status: 'ESCALATED',
        description: complaint.description,
        lat: complaint.lat,
        lng: complaint.lng,
        updatedAt: new Date().toISOString()
      }
    });
  }

  res.json({ ok: true, reaction: body.reaction, counts });
});

export default router;