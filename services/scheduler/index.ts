import 'dotenv/config';

import cron from 'node-cron';
import { Pool } from 'pg';
import { EscalationEngine, isRegionalHoliday, applySlaBreachContractorPenalty, applySlaBreachEngineerPenalty, applyInspectionOverduePenalty, scaleOrgKarmaDelta, getWorkBandFromScore } from '@roadwatch/core';
import { hierarchyForRoadType } from './hierarchy.js';

interface SchedulerConfig {
  serviceName: string;
  timezone: string;
  skipHolidays: boolean;
  gatewayUrl: string;
  internalServiceToken: string;
  cronSyncQueue: string;
  cronKarmaRecalc: string;
  cronSlaCheck: string;
  cronInspectionCheck: string;
  cronAuditCleanup: string;
  cronReportGeneration: string;
  karmaSlaContractor: number;
  karmaSlaEngineer: number;
  orgKarmaBasePenalty: number;
}

function getConfig(): SchedulerConfig {
  return {
    serviceName:          process.env.SERVICE_NAME          || 'scheduler',
    timezone:             process.env.SCHEDULER_TZ          || 'Asia/Kolkata',
    skipHolidays:         (process.env.SLA_SKIP_HOLIDAYS ?? 'true').toLowerCase() !== 'false',
    gatewayUrl:           process.env.GATEWAY_URL           || 'http://127.0.0.1:3100',
    internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN || process.env.SERVICE_TOKEN || '',
    cronSyncQueue:        process.env.CRON_SYNC_QUEUE        || '*/5 * * * *',
    cronKarmaRecalc:      process.env.CRON_KARMA_RECALC      || '0 * * * *',
    cronSlaCheck:         process.env.CRON_SLA_CHECK         || '0 2 * * *',
    cronInspectionCheck:  process.env.CRON_INSPECTION_CHECK  || '30 2 * * *',
    cronAuditCleanup:     process.env.CRON_AUDIT_CLEANUP     || '0 2 * * *',
    cronReportGeneration: process.env.CRON_REPORT_GENERATION || '0 1 * * *',
    karmaSlaContractor:   Number(process.env.KARMA_SLA_CONTRACTOR ?? -20),
    karmaSlaEngineer:     Number(process.env.KARMA_SLA_ENGINEER ?? -15),
    orgKarmaBasePenalty:  Number(process.env.ORG_KARMA_BASE_PENALTY ?? -10),
  };
}

const config = getConfig();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:16432/roadwatch',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

pool.on('error', error => {
  console.warn('[scheduler] PostgreSQL pool error:', error instanceof Error ? error.message : String(error));
});

const schemaExistsCache = new Map<string, boolean>();

async function hasTable(tableName: string): Promise<boolean> {
  const cached = schemaExistsCache.get(`table:${tableName}`);
  if (cached !== undefined) {
    return cached;
  }

  const result = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`]
  );

  const exists = Boolean(result.rows[0]?.exists);
  schemaExistsCache.set(`table:${tableName}`, exists);
  return exists;
}

async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const cached = schemaExistsCache.get(`column:${tableName}.${columnName}`);
  if (cached !== undefined) {
    return cached;
  }

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [tableName, columnName]
  );

  const exists = Boolean(result.rows[0]?.exists);
  schemaExistsCache.set(`column:${tableName}.${columnName}`, exists);
  return exists;
}

async function hasOfflineQueueTable(): Promise<boolean> {
  return hasTable('offline_queue');
}

async function canRecalculateKarmaScores(): Promise<boolean> {
  return (
    (await hasTable('users')) &&
    (await hasTable('complaints')) &&
    (await hasTable('karma_ledger')) &&
    (await hasColumn('complaints', 'user_id')) &&
    (await hasColumn('users', 'karma_score')) &&
    (await hasColumn('users', 'karma_updated_at'))
  );
}

async function ensureSchedulerSchema(): Promise<void> {
  await pool.query('ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS karma_score integer NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS karma_updated_at timestamptz NOT NULL DEFAULT NOW()');
  await pool.query('ALTER TABLE IF EXISTS complaints ADD COLUMN IF NOT EXISTS user_id uuid');
  await pool.query('CREATE INDEX IF NOT EXISTS complaints_user_id_idx ON complaints (user_id)');
  await pool.query(`ALTER TABLE IF EXISTS roads_catalog ADD COLUMN IF NOT EXISTS block_code text`).catch(() => null);
  await pool.query(`ALTER TABLE IF EXISTS roads_catalog ADD COLUMN IF NOT EXISTS authority_org text`).catch(() => null);
  await pool.query(`ALTER TABLE IF EXISTS karma_ledger ALTER COLUMN user_id DROP NOT NULL`).catch(() => null);
  await pool.query(`ALTER TABLE IF EXISTS karma_ledger ADD COLUMN IF NOT EXISTS org_id text`).catch(() => null);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS org_karma (
       org_id text PRIMARY KEY,
       score numeric NOT NULL DEFAULT 100,
       road_km_cache numeric NOT NULL DEFAULT 0,
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`
  ).catch(() => null);
  await pool.query(`ALTER TABLE IF EXISTS complaint_assignments ADD COLUMN IF NOT EXISTS inspection_due_at timestamptz`).catch(() => null);
  await pool.query(`ALTER TABLE IF EXISTS complaint_assignments ADD COLUMN IF NOT EXISTS inspection_completed_at timestamptz`).catch(() => null);
  await pool.query(`ALTER TABLE IF EXISTS complaint_assignments ADD COLUMN IF NOT EXISTS inspection_overdue_notified boolean NOT NULL DEFAULT false`).catch(() => null);
  await pool.query(`ALTER TABLE IF EXISTS contractors ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()`).catch(() => null);

  schemaExistsCache.delete('column:users.karma_score');
  schemaExistsCache.delete('column:users.karma_updated_at');
  schemaExistsCache.delete('column:complaints.user_id');
  schemaExistsCache.delete('table:users');
  schemaExistsCache.delete('table:complaints');
}

async function canCheckSlaBreaches(): Promise<boolean> {
  return (await hasTable('sla_tracking')) && (await hasTable('complaints')) && (await hasTable('event_logs'));
}

async function canCleanupAuditLogs(): Promise<boolean> {
  return hasTable('event_logs');
}

async function canGenerateReports(): Promise<boolean> {
  return (await hasTable('daily_reports')) && (await hasTable('complaints'));
}

function cronOpts(): { timezone: string } {
  return { timezone: config.timezone };
}

async function createInternalNotification(message: {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  audience: { kind: 'jurisdiction'; district: string; zone?: string } | { kind: 'user'; userId: string } | { kind: 'road'; roadId: string };
  critical?: boolean;
}): Promise<void> {
  if (!config.internalServiceToken) {
    console.warn('[scheduler] INTERNAL_SERVICE_TOKEN missing; skipping notification fanout');
    return;
  }

  try {
    const res = await fetch(`${config.gatewayUrl.replace(/\/$/, '')}/internal/notifications/create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': config.internalServiceToken,
      },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[scheduler] notification create failed: ${res.status} ${text}`);
    }
  } catch (error) {
    console.warn('[scheduler] notification create error:', error instanceof Error ? error.message : String(error));
  }
}

async function enqueueStatusChangedOutbox(params: {
  complaintId: string;
  fromStatus: string;
  toStatus: string;
}): Promise<void> {
  if (!(await hasTable('kafka_event_outbox'))) {
    return;
  }

  const idempotencyKey = `complaint:${params.complaintId}:status:${params.fromStatus}->${params.toStatus}:scheduler`;
  const payload = {
    type: 'complaint-status-changed',
    idempotencyKey,
    occurredAt: new Date().toISOString(),
    version: 1,
    complaintId: params.complaintId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    changedBy: { actorType: 'system', actorId: 'scheduler' },
  };

  await pool.query(
    `INSERT INTO kafka_event_outbox
       (id, topic, message_key, headers, payload, idempotency_key, status, attempts, available_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, NULL, $3::jsonb, $4, 'PENDING', 0, NOW(), NOW(), NOW())`,
    ['complaint.status.changed', params.complaintId, JSON.stringify(payload), idempotencyKey]
  ).catch(async () => {
    await pool.query(
      `INSERT INTO kafka_event_outbox
         (id, topic, message_key, payload, status, attempts, available_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())`,
      ['complaint.status.changed', params.complaintId, JSON.stringify(payload)]
    ).catch(() => null);
  });
}

// ---------------------------------------------------------------------------
// Sync pending offline queue items
// ---------------------------------------------------------------------------
async function syncOfflineQueue(): Promise<void> {
  try {
    if (!(await hasOfflineQueueTable())) {
      console.warn('[scheduler] offline_queue table is missing; skipping offline queue sync');
      return;
    }

    const now = new Date();

    const result = await pool.query(
      `UPDATE offline_queue 
       SET synced = true, synced_at = $1 
       WHERE synced = false AND retry_count < 3
       RETURNING id`,
      [now]
    );

    if (result.rowCount === 0) return;

    console.log(`[scheduler] Synced ${result.rowCount} offline queue items`);
  } catch (error) {
    console.error('[scheduler] Error syncing offline queue:', error);
  }
}

// ---------------------------------------------------------------------------
// Recalculate karma scores for all users
// ---------------------------------------------------------------------------
async function recalculateKarmaScores(): Promise<void> {
  try {
    if (!(await canRecalculateKarmaScores())) {
      console.warn('[scheduler] karma recalculation skipped; required tables/columns are missing');
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const result = await pool.query(
      `WITH user_stats AS (
         SELECT
           u.id,
           COALESCE(SUM(CASE WHEN c.status = 'RESOLVED' THEN 1 ELSE 0 END), 0) as resolved_count,
           COALESCE(SUM(CASE WHEN c.created_at > $1 THEN 1 ELSE 0 END), 0) as recent_count,
           COALESCE(AVG(kl.delta), 50) as avg_verification
         FROM users u
         LEFT JOIN complaints c ON u.id = c.user_id
         LEFT JOIN karma_ledger kl ON u.id = kl.user_id
         GROUP BY u.id
       )
       UPDATE users
       SET karma_score = LEAST(1000, GREATEST(0, 
         CAST(us.resolved_count * 10 + us.avg_verification - us.recent_count * 5 AS INT)
       )),
           karma_updated_at = $2,
           updated_at = $2
       FROM user_stats us
       WHERE users.id = us.id
       RETURNING users.id`,
      [sevenDaysAgo, now]
    );

    const updatedCount = result.rowCount || 0;

    if (updatedCount > 0) {
      await pool.query(
        `INSERT INTO karma_ledger (user_id, delta, reason, ref_id, created_at)
         SELECT u.id, u.karma_score, 'hourly_recalc', 'scheduler', $1
         FROM users u
         WHERE u.updated_at = $1`,
        [now]
      );
    }

    console.log(`[scheduler] Recalculated karma scores for ${updatedCount} users`);
  } catch (error) {
    console.error('[scheduler] Error recalculating karma scores:', error);
  }
}

type BreachRow = {
  complaint_id: string;
  contractor_id: string | null;
  district: string | null;
  zone: string | null;
  status: string;
  authority_id: string | null;
  authority_org: string | null;
  road_id: string | null;
  road_type: string | null;
  metadata: Record<string, unknown> | null;
  engineer_user_id: string | null;
  inspector_id: string | null;
  assignment_contractor_id: string | null;
};

// ---------------------------------------------------------------------------
// Night SLA breach detection: alert → escalate/move → breach_notified
// ---------------------------------------------------------------------------
async function checkSlaBreaches(): Promise<void> {
  try {
    if (config.skipHolidays && isRegionalHoliday(new Date(), config.timezone)) {
      console.log(`[scheduler] SLA breach check skipped (holiday in ${config.timezone})`);
      return;
    }

    if (!(await canCheckSlaBreaches())) {
      console.warn('[scheduler] SLA breach detection skipped; required tables are missing');
      return;
    }

    const now = new Date();
    const hasRoadsCatalog = await hasTable('roads_catalog');

    const result = await pool.query<BreachRow>(
      hasRoadsCatalog
        ? `UPDATE sla_tracking st
           SET breached = true, updated_at = $1
           FROM complaints c
           LEFT JOIN roads_catalog rc ON rc.id = c.road_id
           LEFT JOIN complaint_assignments ca ON ca.complaint_id = c.id
           LEFT JOIN LATERAL (
             SELECT engineer_user_id, contractor_id
             FROM road_assignments
             WHERE road_id = c.road_id
             ORDER BY assigned_at DESC NULLS LAST
             LIMIT 1
           ) ra ON true
           WHERE st.complaint_id = c.id
             AND st.breach_notified = false
             AND st.sla_deadline < $1
             AND UPPER(c.status) NOT IN ('RESOLVED', 'CLOSED', 'DISMISSED')
           RETURNING st.complaint_id, st.contractor_id,
                     c.district, c.zone, c.status, c.authority_id, c.authority_org, c.road_id,
                     rc.road_type, c.metadata,
                     ra.engineer_user_id, ca.inspector_id,
                     COALESCE(ca.contractor_id, ra.contractor_id, st.contractor_id) AS assignment_contractor_id`
        : `UPDATE sla_tracking st
           SET breached = true, updated_at = $1
           FROM complaints c
           LEFT JOIN complaint_assignments ca ON ca.complaint_id = c.id
           WHERE st.complaint_id = c.id
             AND st.breach_notified = false
             AND st.sla_deadline < $1
             AND UPPER(c.status) NOT IN ('RESOLVED', 'CLOSED', 'DISMISSED')
           RETURNING st.complaint_id, st.contractor_id,
                     c.district, c.zone, c.status, c.authority_id, c.authority_org, c.road_id,
                     NULL::text AS road_type, c.metadata,
                     NULL::uuid AS engineer_user_id, ca.inspector_id,
                     COALESCE(ca.contractor_id, st.contractor_id) AS assignment_contractor_id`,
      [now]
    );

    if (!result.rowCount) return;

    console.log(`[scheduler] Found ${result.rowCount} SLA breaches, alerting and escalating...`);

    for (const row of result.rows) {
      const complaintId = row.complaint_id;
      const district = row.district ?? 'UNKNOWN';
      const zone = row.zone ?? undefined;
      const fromStatus = row.status;
      const hierarchy = hierarchyForRoadType(row.road_type ?? row.road_id);
      const move = EscalationEngine.nextInLinearHierarchy(String(row.authority_id ?? ''), hierarchy);

      // 1) Breach alert
      await createInternalNotification({
        type: 'sla_warning',
        title: `SLA breached for ${complaintId}`,
        body: `SLA deadline passed for a complaint in ${district}${zone ? ` / ${zone}` : ''}.`,
        data: {
          complaintId,
          district,
          zone: zone ?? null,
          contractorId: row.contractor_id,
          reason: 'sla_deadline_breached',
        },
        audience: { kind: 'jurisdiction', district, zone },
        critical: true,
      });

      const nextAuthorityId = move?.toAuthorityId ?? row.authority_id ?? null;
      const escalationLevel = move?.tier ?? Number((row.metadata as any)?.escalationLevel ?? 0) + 1;
      const prevMeta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};

      // 2) Move to ESCALATED (+ optional authority reassignment)
      await pool.query(
        `UPDATE complaints
         SET status = 'ESCALATED',
             authority_id = COALESCE($2, authority_id),
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
             updated_at = $4
         WHERE id = $1`,
        [
          complaintId,
          nextAuthorityId,
          JSON.stringify({
            ...prevMeta,
            escalationLevel,
            escalatedAt: now.toISOString(),
            escalationReason: 'sla_deadline_breached',
            fromAuthorityId: move?.fromAuthorityId ?? row.authority_id ?? null,
            toAuthorityId: nextAuthorityId,
            source: 'scheduler.checkSlaBreaches',
          }),
          now,
        ]
      );

      // 3) Escalation alert
      await createInternalNotification({
        type: 'escalation',
        title: `Complaint ${complaintId} escalated`,
        body: move
          ? `Auto-escalated from ${move.fromAuthorityId} to ${move.toAuthorityId} after SLA breach.`
          : `Escalation raised for ${district}${zone ? ` / ${zone}` : ''} after SLA breach (already at top tier).`,
        data: {
          complaintId,
          district,
          zone: zone ?? null,
          fromAuthorityId: move?.fromAuthorityId ?? row.authority_id ?? null,
          toAuthorityId: nextAuthorityId,
          reason: 'sla_deadline_breached',
        },
        audience: { kind: 'jurisdiction', district, zone },
        critical: true,
      });

      // 4) Events + outbox
      await pool.query(
        `INSERT INTO event_logs (event_type, entity_id, entity_type, event_data, created_at)
         VALUES ('sla.breached', $1, 'complaint', $2::jsonb, $3)`,
        [
          complaintId,
          JSON.stringify({
            contractorId: row.contractor_id ?? null,
            fromAuthorityId: move?.fromAuthorityId ?? row.authority_id ?? null,
            toAuthorityId: nextAuthorityId,
          }),
          now,
        ]
      ).catch(() => null);

      await pool.query(
        `INSERT INTO event_logs (event_type, entity_id, entity_type, event_data, created_at)
         VALUES ('escalation.due', $1, 'complaint', $2::jsonb, $3)`,
        [
          complaintId,
          JSON.stringify({
            contractorId: row.contractor_id ?? null,
            reason: 'sla_deadline_breached',
            source: 'scheduler.checkSlaBreaches',
            fromAuthorityId: move?.fromAuthorityId ?? row.authority_id ?? null,
            toAuthorityId: nextAuthorityId,
            tier: move?.tier ?? null,
          }),
          now,
        ]
      ).catch(() => null);

      await enqueueStatusChangedOutbox({
        complaintId,
        fromStatus,
        toStatus: 'ESCALATED',
      });

      // 5) Karma: contractor + engineer + size-scaled org
      await applyBreachKarma(row);

      // 6) Mark notified (idempotent)
      await pool.query(
        `UPDATE sla_tracking
         SET breach_notified = true, breached = true, updated_at = $2
         WHERE complaint_id = $1`,
        [complaintId, now]
      );
    }

    console.log(`[scheduler] Processed ${result.rowCount} SLA breach escalations`);
  } catch (error) {
    console.error('[scheduler] Error checking SLA breaches:', error);
  }
}

async function applyUserKarma(userId: string | null | undefined, delta: number, reason: string, refId: string): Promise<void> {
  if (!userId || !delta) return;
  await pool.query(
    `INSERT INTO karma_ledger (user_id, delta, reason, ref_id, created_at)
     VALUES ($1::uuid, $2, $3, $4, NOW())`,
    [userId, delta, reason, refId]
  ).catch(() => null);
  await pool.query(
    `UPDATE users
     SET karma_score = LEAST(1000, GREATEST(-500, COALESCE(karma_score, 0) + $2)),
         karma_updated_at = NOW(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('work_band', $3),
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [userId, delta, getWorkBandFromScore(0)] // band refreshed below
  ).catch(() => null);
  const scoreRes = await pool.query<{ karma_score: number }>(
    `SELECT karma_score FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId]
  ).catch(() => null);
  const score = Number(scoreRes?.rows[0]?.karma_score ?? 0);
  await pool.query(
    `UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('work_band', $2) WHERE id = $1::uuid`,
    [userId, getWorkBandFromScore(score)]
  ).catch(() => null);
}

async function applyContractorKarma(contractorId: string | null | undefined, delta: number, reason: string, refId: string): Promise<void> {
  if (!contractorId || !delta) return;
  await pool.query(
    `UPDATE contractors
     SET metadata = COALESCE(metadata, '{}'::jsonb)
       || jsonb_build_object(
            'karma_score', GREATEST(-500, LEAST(10000, COALESCE((metadata->>'karma_score')::numeric, 100) + $2)),
            'work_band', $3
          ),
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [contractorId, delta, getWorkBandFromScore(100 + delta)]
  ).catch(() => null);
  await pool.query(
    `INSERT INTO karma_ledger (user_id, delta, reason, ref_id, created_at)
     VALUES ($1::uuid, $2, $3, $4, NOW())`,
    [contractorId, delta, reason, refId]
  ).catch(() => null);
}

async function applyOrgKarma(orgId: string | null | undefined, baseDelta: number, reason: string, refId: string): Promise<void> {
  if (!orgId || !baseDelta) return;
  const kmRes = await pool.query<{ km: string }>(
    `SELECT COALESCE(SUM(total_length_km), COUNT(*)::numeric, 0)::text AS km
     FROM roads_catalog WHERE authority_org = $1 OR authority_id = $1`,
    [orgId]
  ).catch(() => null);
  const orgRoadKm = Number(kmRes?.rows[0]?.km ?? 0);
  const delta = scaleOrgKarmaDelta({ basePenalty: baseDelta, orgRoadKm });
  await pool.query(
    `INSERT INTO org_karma (org_id, score, road_km_cache, updated_at)
     VALUES ($1, 100 + $2, $3, NOW())
     ON CONFLICT (org_id) DO UPDATE SET
       score = GREATEST(-10000, LEAST(100000, org_karma.score + $2)),
       road_km_cache = EXCLUDED.road_km_cache,
       updated_at = NOW()`,
    [orgId, delta, orgRoadKm]
  ).catch(async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS org_karma (
         org_id text PRIMARY KEY,
         score numeric NOT NULL DEFAULT 100,
         road_km_cache numeric NOT NULL DEFAULT 0,
         updated_at timestamptz NOT NULL DEFAULT NOW()
       )`
    ).catch(() => null);
    await pool.query(
      `INSERT INTO org_karma (org_id, score, road_km_cache, updated_at)
       VALUES ($1, 100 + $2, $3, NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         score = GREATEST(-10000, LEAST(100000, org_karma.score + $2)),
         road_km_cache = EXCLUDED.road_km_cache,
         updated_at = NOW()`,
      [orgId, delta, orgRoadKm]
    ).catch(() => null);
  });
  await pool.query(
    `INSERT INTO karma_ledger (user_id, org_id, delta, reason, ref_id, created_at)
     VALUES (NULL, $1, $2, $3, $4, NOW())`,
    [orgId, delta, reason, refId]
  ).catch(() => null);
}

async function applyBreachKarma(row: BreachRow): Promise<void> {
  const complaintId = row.complaint_id;
  const contractorId = row.assignment_contractor_id ?? row.contractor_id;
  const engineerId = row.inspector_id ?? row.engineer_user_id;
  const orgId = row.authority_org ?? row.authority_id;

  const ctr = applySlaBreachContractorPenalty(contractorId ?? 'x', config.karmaSlaContractor);
  const eng = applySlaBreachEngineerPenalty(engineerId ?? 'x', config.karmaSlaEngineer);

  if (contractorId) await applyContractorKarma(contractorId, ctr.delta, ctr.reason, complaintId);
  if (engineerId) await applyUserKarma(engineerId, eng.delta, eng.reason, complaintId);
  if (orgId) await applyOrgKarma(orgId, config.orgKarmaBasePenalty, 'sla_breach', complaintId);
}

// ---------------------------------------------------------------------------
// Night inspection overdue: 1 day after contractor complete without engineer verify
// ---------------------------------------------------------------------------
async function checkInspectionOverdue(): Promise<void> {
  try {
    if (config.skipHolidays && isRegionalHoliday(new Date(), config.timezone)) {
      console.log(`[scheduler] Inspection check skipped (holiday in ${config.timezone})`);
      return;
    }

    if (!(await hasTable('complaint_assignments'))) return;

    const now = new Date();
    const result = await pool.query<{
      complaint_id: string;
      inspector_id: string | null;
      engineer_user_id: string | null;
      district: string | null;
      zone: string | null;
      contractor_id: string | null;
    }>(
      `UPDATE complaint_assignments ca
       SET inspection_overdue_notified = true
       FROM complaints c
       LEFT JOIN LATERAL (
         SELECT engineer_user_id FROM road_assignments
         WHERE road_id = c.road_id
         ORDER BY assigned_at DESC NULLS LAST LIMIT 1
       ) ra ON true
       WHERE ca.complaint_id = c.id
         AND ca.completed_at IS NOT NULL
         AND ca.inspection_completed_at IS NULL
         AND ca.inspection_overdue_notified = false
         AND COALESCE(ca.inspection_due_at, ca.completed_at + interval '24 hours') < $1
         AND UPPER(c.status) IN ('RESOLUTION_SUBMITTED', 'IN_PROGRESS', 'ESCALATED')
       RETURNING ca.complaint_id, ca.inspector_id, ra.engineer_user_id, c.district, c.zone, ca.contractor_id`,
      [now]
    ).catch(() => ({ rowCount: 0, rows: [] as any[] }));

    if (!result.rowCount) return;

    console.log(`[scheduler] Found ${result.rowCount} overdue inspections`);

    for (const row of result.rows) {
      const engineerId = row.inspector_id ?? row.engineer_user_id;
      const tx = applyInspectionOverduePenalty(engineerId ?? 'x', config.karmaSlaEngineer);
      if (engineerId) await applyUserKarma(engineerId, tx.delta, tx.reason, row.complaint_id);

      const district = row.district ?? 'UNKNOWN';
      await createInternalNotification({
        type: 'sla_warning',
        title: `Inspection overdue for ${row.complaint_id}`,
        body: `Engineer inspection grace expired after contractor completion in ${district}.`,
        data: { complaintId: row.complaint_id, district, zone: row.zone, reason: 'inspection_overdue' },
        audience: { kind: 'jurisdiction', district, zone: row.zone ?? undefined },
        critical: true,
      });
    }
  } catch (error) {
    console.error('[scheduler] Error checking inspection overdue:', error);
  }
}

// ---------------------------------------------------------------------------
// Cleanup old event/audit logs (older than 90 days)
// ---------------------------------------------------------------------------
async function cleanupAuditLogs(): Promise<void> {
  try {
    if (!(await canCleanupAuditLogs())) {
      console.warn('[scheduler] audit log cleanup skipped; event_logs table is missing');
      return;
    }

    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `DELETE FROM event_logs
       WHERE created_at < $1
       RETURNING id`,
      [cutoff]
    );

    if (result.rowCount === 0) {
      console.log('[scheduler] Audit log cleanup: nothing to delete');
      return;
    }

    console.log(`[scheduler] Deleted ${result.rowCount} old audit/event log entries`);
  } catch (error) {
    console.error('[scheduler] Error cleaning up audit logs:', error);
  }
}

// ---------------------------------------------------------------------------
// Generate daily reports
// ---------------------------------------------------------------------------
async function generateReports(): Promise<void> {
  try {
    if (!(await canGenerateReports())) {
      console.warn('[scheduler] report generation skipped; required tables are missing');
      return;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const dayStart = yesterday;
    const dayEnd   = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000);
    const dateStr  = yesterday.toISOString().split('T')[0];

    const result = await pool.query(
      `WITH daily_stats AS (
         SELECT
           status,
           COUNT(*) as count
         FROM complaints
         WHERE created_at >= $1 AND created_at < $2
         GROUP BY status
       )
       INSERT INTO daily_reports (report_date, total_complaints, resolved_count, pending_count, report_data, created_at)
       SELECT
         $3,
         SUM(count),
         COALESCE((SELECT count FROM daily_stats WHERE status = 'RESOLVED'), 0),
         SUM(CASE WHEN status != 'RESOLVED' THEN count ELSE 0 END),
         jsonb_build_object(
           'total', SUM(count),
           'resolved', COALESCE((SELECT count FROM daily_stats WHERE status = 'RESOLVED'), 0),
           'pending', SUM(CASE WHEN status != 'RESOLVED' THEN count ELSE 0 END),
           'by_status', jsonb_object_agg(status, count)
         ),
         NOW()
       FROM daily_stats
       ON CONFLICT (report_date) DO UPDATE SET
         total_complaints = EXCLUDED.total_complaints,
         resolved_count = EXCLUDED.resolved_count,
         pending_count = EXCLUDED.pending_count,
         report_data = EXCLUDED.report_data,
         created_at = EXCLUDED.created_at
       RETURNING report_date, total_complaints, resolved_count`,
      [dayStart, dayEnd, dateStr]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(`[scheduler] Generated daily report for ${row.report_date} — total: ${row.total_complaints}, resolved: ${row.resolved_count}`);
    }
  } catch (error) {
    console.error('[scheduler] Error generating reports:', error);
  }
}

async function healthCheck(): Promise<void> {
  try {
    await pool.query('SELECT NOW()');
    console.log('[scheduler] Health check: OK');
  } catch (error) {
    console.error('[scheduler] Health check failed:', error);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function initializeScheduler(): Promise<void> {
  console.log(`[${config.serviceName}] Starting scheduler service...`);
  console.log(`[${config.serviceName}] Timezone: ${config.timezone}; skip holidays: ${config.skipHolidays}`);

  try {
    const result = await pool.query('SELECT version()');
    console.log(`[${config.serviceName}] PostgreSQL connected. Version:`, result.rows[0]?.version);
    await ensureSchedulerSchema();
  } catch (error) {
    console.error(`[${config.serviceName}] Failed to connect to PostgreSQL:`, error);
    process.exit(1);
  }

  console.log(`[${config.serviceName}] Scheduling cron jobs:`);

  cron.schedule(config.cronSyncQueue, syncOfflineQueue, cronOpts());
  console.log(`  - Offline queue sync:       ${config.cronSyncQueue} (${config.timezone})`);

  cron.schedule(config.cronKarmaRecalc, recalculateKarmaScores, cronOpts());
  console.log(`  - Karma recalculation:      ${config.cronKarmaRecalc} (${config.timezone})`);

  cron.schedule(config.cronSlaCheck, checkSlaBreaches, cronOpts());
  console.log(`  - SLA breach detection:     ${config.cronSlaCheck} (${config.timezone})`);

  cron.schedule(config.cronInspectionCheck, checkInspectionOverdue, cronOpts());
  console.log(`  - Inspection overdue check: ${config.cronInspectionCheck} (${config.timezone})`);

  cron.schedule(config.cronAuditCleanup, cleanupAuditLogs, cronOpts());
  console.log(`  - Audit log cleanup:        ${config.cronAuditCleanup} (${config.timezone})`);

  cron.schedule(config.cronReportGeneration, generateReports, cronOpts());
  console.log(`  - Report generation:        ${config.cronReportGeneration} (${config.timezone})`);

  setInterval(healthCheck, 60_000);
  console.log(`  - Health checks:            every 60s`);

  console.log(`\n[${config.serviceName}] All cron jobs initialized. Running...`);

  const shutdown = async (signal: string) => {
    console.log(`[${config.serviceName}] Received ${signal}, shutting down gracefully...`);
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

const isMain = process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test';
if (isMain) {
  initializeScheduler().catch((error: unknown) => {
    console.error('[scheduler] Failed to initialize:', error);
    process.exit(1);
  });
}

export { checkSlaBreaches, hierarchyForRoadType };
