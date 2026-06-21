import 'dotenv/config';

import cron from 'node-cron';
import { Pool } from 'pg';

async function registerServiceWithGateway(input: {
  gatewayUrl: string;
  service: {
    name: string;
    address: string;
    description?: string;
  };
  registrySecret?: string;
}): Promise<void> {
  const response = await fetch(`${input.gatewayUrl.replace(/\/$/, '')}/services/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.registrySecret ? { 'x-service-registry-secret': input.registrySecret } : {})
    },
    body: JSON.stringify(input.service)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Service registration failed (${response.status}): ${body}`);
  }
}

interface SchedulerConfig {
  serviceName: string;
  cronSyncQueue: string;
  cronKarmaRecalc: string;
  cronSlaCheck: string;
  cronAuditCleanup: string;
  cronReportGeneration: string;
}

function getConfig(): SchedulerConfig {
  return {
    serviceName:          process.env.SERVICE_NAME          || 'scheduler',
    cronSyncQueue:        process.env.CRON_SYNC_QUEUE        || '*/5 * * * *',
    cronKarmaRecalc:      process.env.CRON_KARMA_RECALC      || '0 * * * *',
    cronSlaCheck:         process.env.CRON_SLA_CHECK         || '*/30 * * * *',
    cronAuditCleanup:     process.env.CRON_AUDIT_CLEANUP     || '0 2 * * *',
    cronReportGeneration: process.env.CRON_REPORT_GENERATION || '0 1 * * *'
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

// ---------------------------------------------------------------------------
// Sync pending offline queue items
// Called every 5 minutes.
//
// PostgreSQL: single UPDATE WHERE synced = false
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
// Called hourly.
//
// Karma formula:
//   resolved_count * 10
//   + avg_verification_score (0–100, default 50)
//   - recent_complaints_7d * 5
//   clamped to [0, 1000]
// ---------------------------------------------------------------------------
async function recalculateKarmaScores(): Promise<void> {
  try {
    if (!(await canRecalculateKarmaScores())) {
      console.warn('[scheduler] karma recalculation skipped; required tables/columns are missing');
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    // Calculate karma in a single query with aggregation
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

    // Append immutable ledger entries for audit trail
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

// ---------------------------------------------------------------------------
// Check for SLA breaches and escalate
// Called every 30 minutes.
// ---------------------------------------------------------------------------
async function checkSlaBreaches(): Promise<void> {
  try {
    if (!(await canCheckSlaBreaches())) {
      console.warn('[scheduler] SLA breach detection skipped; required tables are missing');
      return;
    }

    const now = new Date();

    const result = await pool.query(
      `UPDATE sla_tracking
       SET breached = true, breach_notified = false, updated_at = $1
       WHERE breached = false AND sla_deadline < $1
       RETURNING complaint_id, contractor_id`,
      [now]
    );

    if (result.rowCount === 0) return;

    const breachedComplaints = result.rows.map((r: any) => r.complaint_id);

    // Update complaint status for all breached items using canonical uppercase status
    await pool.query(
      `UPDATE complaints
       SET status = 'SLA_BREACHED', updated_at = $1
       WHERE id = ANY($2)`,
      [now, breachedComplaints]
    );

    // Log events for all breaches
    await pool.query(
      `INSERT INTO event_logs (event_type, entity_id, entity_type, event_data, created_at)
       SELECT 'sla.breached', complaint_id, 'complaint', 
              jsonb_build_object('contractorId', contractor_id), $1
       FROM sla_tracking
       WHERE breached = true AND updated_at = $1`,
      [now]
    );

    console.log(`[scheduler] Found ${result.rowCount} SLA breaches, escalating...`);
  } catch (error) {
    console.error('[scheduler] Error checking SLA breaches:', error);
  }
}

// ---------------------------------------------------------------------------
// Cleanup old event/audit logs (older than 90 days)
// Called daily at 2 AM.
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
// Called daily at 1 AM.
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
    const dateStr  = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    // Single query to compute all statistics
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

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
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

  try {
    const result = await pool.query('SELECT version()');
    console.log(`[${config.serviceName}] PostgreSQL connected. Version:`, result.rows[0]?.version);
    await ensureSchedulerSchema();
  } catch (error) {
    console.error(`[${config.serviceName}] Failed to connect to PostgreSQL:`, error);
    process.exit(1);
  }

  console.log(`[${config.serviceName}] Scheduling cron jobs:`);

  cron.schedule(config.cronSyncQueue,        syncOfflineQueue);
  console.log(`  ✓ Offline queue sync:       ${config.cronSyncQueue}`);

  cron.schedule(config.cronKarmaRecalc,      recalculateKarmaScores);
  console.log(`  ✓ Karma recalculation:      ${config.cronKarmaRecalc}`);

  cron.schedule(config.cronSlaCheck,         checkSlaBreaches);
  console.log(`  ✓ SLA breach detection:     ${config.cronSlaCheck}`);

  cron.schedule(config.cronAuditCleanup,     cleanupAuditLogs);
  console.log(`  ✓ Audit log cleanup:        ${config.cronAuditCleanup}`);

  cron.schedule(config.cronReportGeneration, generateReports);
  console.log(`  ✓ Report generation:        ${config.cronReportGeneration}`);

  setInterval(healthCheck, 60_000);
  console.log(`  ✓ Health checks:            every 60s`);

  console.log(`\n[${config.serviceName}] All cron jobs initialized. Running...`);

  void registerServiceWithGateway({
    gatewayUrl: process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100',
    service: {
      name: config.serviceName,
      address: process.env.SERVICE_URL ?? `service://${config.serviceName}`,
      description: 'RoadWatch scheduler worker'
    },
    registrySecret: process.env.SERVICE_REGISTRY_SECRET
  }).catch(error => {
    console.warn(`[${config.serviceName}] service registration failed:`, error instanceof Error ? error.message : String(error));
  });

  const shutdown = async (signal: string) => {
    console.log(`[${config.serviceName}] Received ${signal}, shutting down gracefully...`);
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

initializeScheduler().catch(error => {
  console.error('[scheduler] Failed to initialize:', error);
  process.exit(1);
});