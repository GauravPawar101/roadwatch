/**
 * Shared complaint lifecycle: SLA tracking, karma ledger, merge/escalation helpers.
 */
import {
  EscalationEngine,
  applyValidSubmissionBonus,
  applyDuplicatePenalty,
  getTierFromScore,
  type KarmaConfig,
  type KarmaRecord,
} from '@roadwatch/core';
import { countryAdapter, RoadType, Severity } from '@roadwatch/adapters';
import { pool } from '../postgres.js';

export const DEFAULT_KARMA_CONFIG: KarmaConfig = {
  initial_score: 100,
  valid_submission_bonus: 10,
  flagged_penalty: -50,
  duplicate_penalty: -30,
  rejected_penalty: -75,
  appeal_success_restore: 30,
  daily_submission_limit: 10,
  suspension_threshold_score: -100,
  ban_threshold_penalty_count: 3,
};

/** Map roads_catalog.road_type text (or road id) to adapter RoadType. */
export function roadTypeFromCatalog(roadTypeOrId: string | null | undefined): RoadType {
  const raw = String(roadTypeOrId ?? '').trim().toUpperCase();
  if (!raw) return RoadType.URBAN;
  if (raw === 'NH' || raw.startsWith('NH')) return RoadType.NH;
  if (raw === 'SH' || raw.startsWith('SH')) return RoadType.SH;
  if (raw === 'MDR' || raw.startsWith('MDR')) return RoadType.MDR;
  if (raw === 'RURAL' || raw.startsWith('VR') || raw.startsWith('ODR')) return RoadType.RURAL;
  if (raw === 'URBAN') return RoadType.URBAN;
  return RoadType.URBAN;
}

/** SLA hours: road-type primary grace (NH/SH/MDR = 7d, URBAN/RURAL = 2d). */
export function slaHoursForRoadType(roadTypeOrId: string | null | undefined = 'URBAN'): number {
  const roadType = roadTypeFromCatalog(roadTypeOrId);
  return countryAdapter.calculateSLA(Severity.MODERATE, roadType);
}

/** @deprecated Prefer slaHoursForRoadType — severity no longer drives graded grace. */
export function slaHoursForSeverity(severity = 3, roadTypeOrId: string | null | undefined = 'URBAN'): number {
  void severity;
  return slaHoursForRoadType(roadTypeOrId);
}

export function slaDeadlineFromNow(
  severity = 3,
  roadTypeOrId: string | null | undefined = 'URBAN'
): Date {
  const hours = slaHoursForSeverity(severity, roadTypeOrId);
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function ensureSlaTracking(
  complaintId: string,
  opts: {
    contractorId?: string | null;
    severity?: number;
    deadline?: Date;
    roadType?: string | null;
  } = {}
): Promise<void> {
  let roadType = opts.roadType ?? null;
  if (!roadType) {
    const roadRes = await pool.query<{ road_type: string | null; road_id: string | null }>(
      `SELECT c.road_id, rc.road_type
       FROM complaints c
       LEFT JOIN roads_catalog rc ON rc.id = c.road_id
       WHERE c.id = $1
       LIMIT 1`,
      [complaintId]
    ).catch(() => null);
    roadType = roadRes?.rows[0]?.road_type ?? roadRes?.rows[0]?.road_id ?? null;
  }

  const deadline = opts.deadline ?? slaDeadlineFromNow(opts.severity ?? 3, roadType);
  await pool.query(
    `INSERT INTO sla_tracking (complaint_id, contractor_id, breached, breach_notified, sla_deadline, updated_at)
     VALUES ($1, $2, false, false, $3, NOW())
     ON CONFLICT (complaint_id) DO UPDATE SET
       contractor_id = COALESCE(EXCLUDED.contractor_id, sla_tracking.contractor_id),
       sla_deadline = COALESCE(sla_tracking.sla_deadline, EXCLUDED.sla_deadline),
       updated_at = NOW()`,
    [complaintId, opts.contractorId ?? null, deadline]
  );
}

async function loadKarmaRecord(userId: string): Promise<KarmaRecord> {
  const existing = await pool.query<{ karma_score: number }>(
    `SELECT karma_score FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const score = Number(existing.rows[0]?.karma_score ?? DEFAULT_KARMA_CONFIG.initial_score);
  return {
    id: userId,
    user_id: userId,
    score,
    tier: getTierFromScore(score, 0, 0),
    penalty_count: 0,
    suspended_until: 0,
    daily_submission_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

export async function awardKarma(
  userId: string,
  delta: number,
  reason: string,
  refId?: string
): Promise<{ score: number; delta: number; reason: string }> {
  if (!userId || !Number.isFinite(delta) || delta === 0) {
    return { score: 0, delta: 0, reason };
  }

  await pool.query(
    `INSERT INTO karma_ledger (user_id, delta, reason, ref_id, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, delta, reason, refId ?? null]
  ).catch(() => null);

  const updated = await pool.query<{ karma_score: number }>(
    `UPDATE users
     SET karma_score = LEAST(1000, GREATEST(0, COALESCE(karma_score, 0) + $2)),
         karma_updated_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING karma_score`,
    [userId, delta]
  ).catch(() => null);

  return {
    score: Number(updated?.rows[0]?.karma_score ?? 0),
    delta,
    reason,
  };
}

export async function awardValidSubmissionKarma(userId: string, complaintId: string) {
  const current = await loadKarmaRecord(userId);
  const tx = applyValidSubmissionBonus(current, DEFAULT_KARMA_CONFIG);
  return awardKarma(userId, tx.delta, tx.reason, complaintId);
}

export async function awardDuplicateImagePenalty(userId: string, submissionRef: string) {
  const current = await loadKarmaRecord(userId);
  const tx = applyDuplicatePenalty(current, DEFAULT_KARMA_CONFIG, submissionRef);
  return awardKarma(userId, tx.delta, tx.reason, submissionRef);
}

export type MergeCandidate = {
  id: string;
  status: string;
  report_count: number | null;
  created_at: string | Date;
  updated_at: string | Date;
  lat: number | null;
  lng: number | null;
  metadata?: Record<string, unknown> | null;
};

export function shouldEscalateOnMerge(existing: MergeCandidate, windowMs: number): {
  escalate: boolean;
  reason: string | null;
} {
  const status = String(existing.status ?? '').toUpperCase();
  const isResolved = status === 'RESOLVED';
  const ageMs = isResolved
    ? Date.now() - new Date(existing.updated_at).getTime()
    : Date.now() - new Date(existing.created_at).getTime();

  if (isResolved && ageMs <= windowMs) {
    return { escalate: true, reason: 'resolved-within-sla-window' };
  }
  if (!isResolved && ageMs >= windowMs) {
    return { escalate: true, reason: 'active-past-sla-window' };
  }
  return { escalate: false, reason: isResolved ? null : 'same-location-merge' };
}

/** Use EscalationEngine for overdue open complaints (batch check). */
export function checkEscalationsDue(
  complaints: Array<{
    id: string;
    citizenId: string;
    status: string;
    submittedAt: number;
    authorityId: string;
    description: string;
    lat: number;
    lng: number;
    category?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>,
  now = Date.now()
) {
  const adapter = {
    getSlaHours: (category: string, priority: string) => {
      const sev =
        priority === 'CRITICAL' ? Severity.CRITICAL :
        priority === 'HIGH' ? Severity.HIGH :
        priority === 'MEDIUM' ? Severity.MODERATE :
        Severity.LOW;
      void category;
      return countryAdapter.calculateSLA(sev, RoadType.URBAN);
    },
    routingTable: { hierarchy: (countryAdapter as any).routingTable?.hierarchy ?? {} },
  };

  return EscalationEngine.checkAllDue(
    complaints.map((c) => ({
      ID: c.id,
      citizenId: c.citizenId,
      category: c.category ?? 'road',
      priority: c.priority ?? 'MEDIUM',
      status: c.status,
      submittedAt: c.submittedAt,
      assignedAuthorityId: c.authorityId,
      description: c.description,
      location: { latitude: c.lat, longitude: c.lng },
    })),
    now,
    adapter
  );
}

/**
 * Resolve the next authority tier for an SLA escalation move using the country adapter hierarchy.
 */
export function resolveNextAuthorityEscalation(
  currentAuthorityId: string | null | undefined,
  roadTypeOrId: string | null | undefined
): { fromAuthorityId: string; toAuthorityId: string; tier: number; hierarchy: string[] } | null {
  const roadType = roadTypeFromCatalog(roadTypeOrId);
  const hierarchy = countryAdapter.getAuthorityHierarchy(roadType);
  const step = EscalationEngine.nextInLinearHierarchy(String(currentAuthorityId ?? ''), hierarchy);
  if (!step) return null;
  return { ...step, hierarchy };
}

export async function findDuplicateGeotaggedImage(sha256: string, userId?: string): Promise<string | null> {
  if (!sha256) return null;
  const result = await pool.query<{ complaint_id: string }>(
    `SELECT complaint_id
     FROM complaint_attachments
     WHERE file_sha256 = $1
       AND ($2::uuid IS NULL OR complaint_id IN (SELECT id FROM complaints WHERE user_id = $2))
     ORDER BY created_at DESC
     LIMIT 1`,
    [sha256, userId ?? null]
  );
  return result.rows[0]?.complaint_id ?? null;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
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

export const RECURRENCE_RADIUS_M = 100;

export async function applyUserKarmaDelta(
  userId: string | null | undefined,
  delta: number,
  reason: string,
  refId?: string
): Promise<void> {
  if (!userId || !Number.isFinite(delta) || delta === 0) return;
  await awardKarma(userId, delta, reason, refId);
  await pool.query(
    `UPDATE users
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
       'work_band',
       CASE
         WHEN COALESCE(karma_score, 0) >= 500 THEN 'Trusted'
         WHEN COALESCE(karma_score, 0) >= 100 THEN 'Standard'
         WHEN COALESCE(karma_score, 0) >= 0 THEN 'AtRisk'
         ELSE 'Suspended'
       END
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [userId]
  ).catch(() => null);
}

export async function applyContractorKarmaDelta(
  contractorId: string | null | undefined,
  delta: number,
  reason: string,
  refId?: string
): Promise<void> {
  if (!contractorId || !Number.isFinite(delta) || delta === 0) return;

  await pool.query(
    `UPDATE contractors
     SET metadata = COALESCE(metadata, '{}'::jsonb)
       || jsonb_build_object(
            'karma_score', GREATEST(-500, LEAST(10000,
              COALESCE((metadata->>'karma_score')::numeric, 100) + $2
            )),
            'work_band', CASE
              WHEN COALESCE((metadata->>'karma_score')::numeric, 100) + $2 >= 500 THEN 'Trusted'
              WHEN COALESCE((metadata->>'karma_score')::numeric, 100) + $2 >= 100 THEN 'Standard'
              WHEN COALESCE((metadata->>'karma_score')::numeric, 100) + $2 >= 0 THEN 'AtRisk'
              ELSE 'Suspended'
            END
          ),
         updated_at = NOW()
     WHERE id = $1`,
    [contractorId, delta]
  ).catch(() => null);

  // Also ledger against linked contractor user if present
  const userRes = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'CONTRACTOR' AND (
       id::text = $1 OR metadata->>'contractor_id' = $1
     ) LIMIT 1`,
    [contractorId]
  ).catch(() => null);
  const linkedUserId = userRes?.rows[0]?.id;
  if (linkedUserId) {
    await applyUserKarmaDelta(linkedUserId, delta, reason, refId);
  } else {
    await pool.query(
      `INSERT INTO karma_ledger (user_id, delta, reason, ref_id, created_at)
       VALUES ($1::uuid, $2, $3, $4, NOW())`,
      [contractorId, delta, reason, refId ?? null]
    ).catch(() => null);
  }
}

export async function getOrgRoadKm(orgId: string): Promise<number> {
  const result = await pool.query<{ km: string | null; cnt: string }>(
    `SELECT COALESCE(SUM(total_length_km), 0)::text AS km, COUNT(*)::text AS cnt
     FROM roads_catalog
     WHERE authority_org = $1 OR authority_id = $1`,
    [orgId]
  ).catch(() => null);
  const km = Number(result?.rows[0]?.km ?? 0);
  const cnt = Number(result?.rows[0]?.cnt ?? 0);
  return km > 0 ? km : cnt;
}

export async function applyOrgKarmaDelta(
  orgId: string | null | undefined,
  baseDelta: number,
  reason: string,
  refId?: string
): Promise<number> {
  if (!orgId || !Number.isFinite(baseDelta) || baseDelta === 0) return 0;
  const { scaleOrgKarmaDelta } = await import('@roadwatch/core');
  const orgRoadKm = await getOrgRoadKm(orgId);
  const delta = scaleOrgKarmaDelta({ basePenalty: baseDelta, orgRoadKm });

  await pool.query(
    `INSERT INTO org_karma (org_id, score, road_km_cache, updated_at)
     VALUES ($1, GREATEST(-10000, LEAST(100000, 100 + $2)), $3, NOW())
     ON CONFLICT (org_id) DO UPDATE SET
       score = GREATEST(-10000, LEAST(100000, org_karma.score + $2)),
       road_km_cache = EXCLUDED.road_km_cache,
       updated_at = NOW()`,
    [orgId, delta, orgRoadKm]
  ).catch(() => null);

  await pool.query(
    `INSERT INTO karma_ledger (user_id, org_id, delta, reason, ref_id, created_at)
     VALUES (NULL, $1, $2, $3, $4, NOW())`,
    [orgId, delta, reason, refId ?? orgId]
  ).catch(() => null);

  return delta;
}

/**
 * After a recurrence on a previously completed/resolved complaint within 100m:
 * penalize engineer + contractor, and org if still inside original SLA window.
 */
export async function applyRecurrenceKarmaPenalties(params: {
  complaintId: string;
  roadId?: string | null;
  withinOriginalSla: boolean;
}): Promise<void> {
  const { applyRecurrencePenalty } = await import('@roadwatch/core');
  const assignRes = await pool.query<{
    contractor_id: string | null;
    inspector_id: string | null;
    engineer_user_id: string | null;
    authority_org: string | null;
    authority_id: string | null;
  }>(
    `SELECT ca.contractor_id, ca.inspector_id,
            ra.engineer_user_id, c.authority_org, c.authority_id
     FROM complaints c
     LEFT JOIN complaint_assignments ca ON ca.complaint_id = c.id
     LEFT JOIN road_assignments ra ON ra.road_id = c.road_id
     WHERE c.id = $1
     ORDER BY ra.assigned_at DESC NULLS LAST
     LIMIT 1`,
    [params.complaintId]
  ).catch(() => null);

  const row = assignRes?.rows[0];
  const engineerId = row?.inspector_id ?? row?.engineer_user_id ?? null;
  const contractorId = row?.contractor_id ?? null;
  const orgId = row?.authority_org ?? row?.authority_id ?? null;

  const engTx = applyRecurrencePenalty(engineerId ?? 'unknown');
  const ctrTx = applyRecurrencePenalty(contractorId ?? 'unknown');

  if (engineerId) {
    await applyUserKarmaDelta(engineerId, engTx.delta, engTx.reason, params.complaintId);
  }
  if (contractorId) {
    await applyContractorKarmaDelta(contractorId, ctrTx.delta, ctrTx.reason, params.complaintId);
  }
  if (params.withinOriginalSla && orgId) {
    const base = Number(process.env.ORG_KARMA_BASE_PENALTY ?? -10);
    await applyOrgKarmaDelta(orgId, base, 'within_sla_recurrence', params.complaintId);
  }
}

export async function applySlaBreachKarmaPenalties(params: {
  complaintId: string;
  contractorId?: string | null;
  engineerUserId?: string | null;
  orgId?: string | null;
}): Promise<void> {
  const {
    applySlaBreachContractorPenalty,
    applySlaBreachEngineerPenalty,
  } = await import('@roadwatch/core');

  if (params.contractorId) {
    const tx = applySlaBreachContractorPenalty(params.contractorId);
    await applyContractorKarmaDelta(params.contractorId, tx.delta, tx.reason, params.complaintId);
  }
  if (params.engineerUserId) {
    const tx = applySlaBreachEngineerPenalty(params.engineerUserId);
    await applyUserKarmaDelta(params.engineerUserId, tx.delta, tx.reason, params.complaintId);
  }
  if (params.orgId) {
    const base = Number(process.env.ORG_KARMA_BASE_PENALTY ?? -10);
    await applyOrgKarmaDelta(params.orgId, base, 'sla_breach', params.complaintId);
  }
}

export async function rewardOrgForRepair(orgId: string | null | undefined, complaintId: string): Promise<void> {
  if (!orgId) return;
  const base = Number(process.env.ORG_KARMA_REPAIR_BONUS ?? 5);
  await applyOrgKarmaDelta(orgId, Math.abs(base), 'verified_repair', complaintId);
}

export async function rewardOrgForNewRoad(orgId: string | null | undefined, roadId: string): Promise<void> {
  if (!orgId) return;
  const base = Number(process.env.ORG_KARMA_NEW_ROAD_BONUS ?? 8);
  await applyOrgKarmaDelta(orgId, Math.abs(base), 'new_road', roadId);
}
