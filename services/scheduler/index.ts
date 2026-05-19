import 'dotenv/config';

import { Client, types } from 'cassandra-driver';
import cron from 'node-cron';

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
    // Original had a 6-field typo ('*/30 * * * * *' = every 30s).
    // docker-compose uses '*/30 * * * *' (every 30 min) — that is the intended value.
    cronSlaCheck:         process.env.CRON_SLA_CHECK         || '*/30 * * * *',
    cronAuditCleanup:     process.env.CRON_AUDIT_CLEANUP     || '0 2 * * *',
    cronReportGeneration: process.env.CRON_REPORT_GENERATION || '0 1 * * *'
  };
}

const config = getConfig();

const client = new Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042')
    .split(',')
    .map(s => s.split(':')[0]),
  localDataCenter: process.env.CASSANDRA_LOCAL_DC    || 'datacenter1',
  keyspace:        process.env.CASSANDRA_KEYSPACE    || 'roadwatch'
});

// ---------------------------------------------------------------------------
// Timestamp helpers (replace Postgres INTERVAL arithmetic)
// ---------------------------------------------------------------------------
const HOUR_MS  = 60 * 60 * 1_000;
const DAY_MS   = 24 * HOUR_MS;
const WEEK_MS  =  7 * DAY_MS;
const DAY90_MS = 90 * DAY_MS;

function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

// ---------------------------------------------------------------------------
// Sync pending offline queue items
// Called every 5 minutes.
//
// Postgres: UPDATE … WHERE synced = false … RETURNING id
// Cassandra: SELECT keys first, then fan-out UPDATEs; count in JS.
// ALLOW FILTERING is acceptable here — offline_queue is a small PoC table.
// ---------------------------------------------------------------------------
async function syncOfflineQueue(): Promise<void> {
  try {
    const now = new Date();

    const result = await client.execute(
      'SELECT id FROM offline_queue WHERE synced = false AND retry_count < 3 ALLOW FILTERING',
      [],
      { prepare: true }
    );

    if (result.rowLength === 0) return;

    await Promise.all(
      result.rows.map(row =>
        client.execute(
          'UPDATE offline_queue SET synced = true, synced_at = ? WHERE id = ?',
          [now, row.id],
          { prepare: true }
        )
      )
    );

    console.log(`[scheduler] Synced ${result.rowLength} offline queue items`);
  } catch (error) {
    console.error('[scheduler] Error syncing offline queue:', error);
  }
}

// ---------------------------------------------------------------------------
// Recalculate karma scores for all users
// Called hourly.
//
// Postgres: single CTE + UPDATE across joined tables.
// Cassandra: no joins — for each user fetch complaint counts from
//   complaints_by_user (denormalized partition) and ledger deltas from
//   karma_ledger_by_user, compute in JS, write back to users + ledger.
//
// Karma formula (mirrors original):
//   resolved_count * 10
//   + avg_verification_score (0–100, default 50)
//   - recent_complaints_7d * 5
//   clamped to [0, 1000]
// ---------------------------------------------------------------------------
async function recalculateKarmaScores(): Promise<void> {
  try {
    const sevenDaysAgo = msAgo(WEEK_MS);
    const now = new Date();

    const usersResult = await client.execute(
      'SELECT id FROM users',
      [],
      { prepare: true }
    );

    let updated = 0;

    for (const userRow of usersResult.rows) {
      const userId: string = userRow.id;

      // Complaint stats from denormalized partition
      const complaintsResult = await client.execute(
        'SELECT status, created_at FROM complaints_by_user WHERE user_id = ?',
        [userId],
        { prepare: true }
      );

      let resolvedCount = 0;
      let recentCount   = 0;
      for (const c of complaintsResult.rows) {
        if (c.status === 'resolved') resolvedCount++;
        if (c.created_at && new Date(c.created_at) > sevenDaysAgo) recentCount++;
      }

      // Verification score proxy: average delta from karma ledger
      const ledgerResult = await client.execute(
        'SELECT delta FROM karma_ledger_by_user WHERE user_id = ?',
        [userId],
        { prepare: true }
      );
      const deltas = ledgerResult.rows
        .map(r => r.delta as number)
        .filter(d => typeof d === 'number');
      const avgVerification =
        deltas.length > 0
          ? deltas.reduce((a, b) => a + b, 0) / deltas.length
          : 50;

      const karmaScore = Math.min(
        1000,
        Math.max(0, resolvedCount * 10 + avgVerification - recentCount * 5)
      );
      const karmaInt = Math.round(karmaScore);

      // Write cached score back to users table
      await client.execute(
        'UPDATE users SET karma_score = ? WHERE id = ?',
        [karmaInt, userId],
        { prepare: true }
      );

      // Append immutable ledger entry for audit trail
      const ledgerId = types.TimeUuid.now();
      await Promise.all([
        client.execute(
          'INSERT INTO karma_ledger (id, user_id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [ledgerId, userId, karmaInt, 'hourly_recalc', 'scheduler', now],
          { prepare: true }
        ),
        client.execute(
          'INSERT INTO karma_ledger_by_user (user_id, id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, ledgerId, karmaInt, 'hourly_recalc', 'scheduler', now],
          { prepare: true }
        )
      ]);

      updated++;
    }

    console.log(`[scheduler] Recalculated karma scores for ${updated} users`);
  } catch (error) {
    console.error('[scheduler] Error recalculating karma scores:', error);
  }
}

// ---------------------------------------------------------------------------
// Check for SLA breaches and escalate
// Called every 30 minutes.
//
// Postgres: single UPDATE … WHERE created_at < NOW() - INTERVAL '24 hours'
// Cassandra: read sla_tracking rows where breached = false, filter deadline
//   in JS (timestamps are plain values — no DB-side INTERVAL needed), then
//   fan-out UPDATE + event log INSERT.
// ---------------------------------------------------------------------------
async function checkSlaBreaches(): Promise<void> {
  try {
    const now = new Date();

    const result = await client.execute(
      'SELECT complaint_id, contractor_id, sla_deadline FROM sla_tracking WHERE breached = false ALLOW FILTERING',
      [],
      { prepare: true }
    );

    const breached = result.rows.filter(row => {
      const deadline: Date | null = row.sla_deadline ? new Date(row.sla_deadline) : null;
      return deadline !== null && deadline < now;
    });

    if (breached.length === 0) return;

    await Promise.all(
      breached.flatMap(row => [
        // Mark breach in sla_tracking
        client.execute(
          'UPDATE sla_tracking SET breached = true, breach_notified = false, updated_at = ? WHERE complaint_id = ?',
          [now, row.complaint_id],
          { prepare: true }
        ),
        // Reflect on the complaint row
        client.execute(
          'UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?',
          ['sla_breached', now, row.complaint_id],
          { prepare: true }
        ),
        // Immutable event log entry
        client.execute(
          'INSERT INTO event_logs (id, event_type, entity_id, entity_type, event_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [
            types.TimeUuid.now(),
            'sla.breached',
            row.complaint_id,
            'complaint',
            JSON.stringify({ contractorId: row.contractor_id }),
            now
          ],
          { prepare: true }
        )
      ])
    );

    console.log(`[scheduler] Found ${breached.length} SLA breaches, escalating...`);
  } catch (error) {
    console.error('[scheduler] Error checking SLA breaches:', error);
  }
}

// ---------------------------------------------------------------------------
// Cleanup old event/audit logs (older than 90 days)
// Called daily at 2 AM.
//
// Postgres: DELETE … WHERE created_at < NOW() - INTERVAL '90 days' RETURNING id
// Cassandra: event_logs PK is timeuuid — use minTimeuuid(cutoff) to find old
//   rows, then DELETE by PK. For high-volume production use TTL at write time
//   instead; this loop is fine at PoC scale.
// ---------------------------------------------------------------------------
async function cleanupAuditLogs(): Promise<void> {
  try {
    const cutoff = msAgo(DAY90_MS);

    // minTimeuuid(t) returns the smallest timeuuid for timestamp t,
    // so id < minTimeuuid(cutoff) means the row is older than cutoff.
    const result = await client.execute(
      'SELECT id FROM event_logs WHERE id < minTimeuuid(?) ALLOW FILTERING',
      [cutoff],
      { prepare: true }
    );

    if (result.rowLength === 0) {
      console.log('[scheduler] Audit log cleanup: nothing to delete');
      return;
    }

    await Promise.all(
      result.rows.map(row =>
        client.execute('DELETE FROM event_logs WHERE id = ?', [row.id], { prepare: true })
      )
    );

    console.log(`[scheduler] Deleted ${result.rowLength} old audit/event log entries`);
  } catch (error) {
    console.error('[scheduler] Error cleaning up audit logs:', error);
  }
}

// ---------------------------------------------------------------------------
// Generate daily reports
// Called daily at 1 AM.
//
// Postgres: INSERT … SELECT … ON CONFLICT DO UPDATE (upsert via sub-select
//   with json_build_object aggregation).
// Cassandra: no aggregation across partitions — iterate known statuses,
//   count rows per complaints_by_status partition between dayStart/dayEnd,
//   compute totals in JS, then INSERT into daily_reports (last-write-wins
//   = natural upsert, same semantics as ON CONFLICT DO UPDATE).
// ---------------------------------------------------------------------------
async function generateReports(): Promise<void> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const dayStart = yesterday;
    const dayEnd   = new Date(yesterday.getTime() + DAY_MS);
    const dateStr  = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    const statuses = [
      'submitted', 'assigned', 'in_progress',
      'resolved',  'closed',   'rejected',
      'sla_breached', 'anchored'
    ];

    const counts: Record<string, number> = {};
    let total = 0;

    for (const status of statuses) {
      const r = await client.execute(
        'SELECT id FROM complaints_by_status WHERE status = ? AND created_at >= ? AND created_at < ?',
        [status, dayStart, dayEnd],
        { prepare: true }
      );
      counts[status] = r.rowLength;
      total += r.rowLength;
    }

    const resolved   = counts['resolved'] ?? 0;
    const pending    = total - resolved;
    const reportData = JSON.stringify({ total, resolved, pending, by_status: counts });
    const now        = new Date();

    // Cassandra INSERT overwrites same PK — equivalent to ON CONFLICT DO UPDATE
    await client.execute(
      `INSERT INTO daily_reports
         (report_date, total_complaints, resolved_count, pending_count, report_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [dateStr, total, resolved, pending, reportData, now],
      { prepare: true }
    );

    console.log(`[scheduler] Generated daily report for ${dateStr} — total: ${total}, resolved: ${resolved}`);
  } catch (error) {
    console.error('[scheduler] Error generating reports:', error);
  }
}

// ---------------------------------------------------------------------------
// Health check — replaced pool.query('SELECT 1') with system.local read
// ---------------------------------------------------------------------------
async function healthCheck(): Promise<void> {
  try {
    await client.execute('SELECT release_version FROM system.local');
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
    await client.connect();
    const ver = await client.execute('SELECT release_version FROM system.local');
    console.log(`[${config.serviceName}] Cassandra connected. Version:`, ver.rows[0]?.release_version);
  } catch (error) {
    console.error(`[${config.serviceName}] Failed to connect to Cassandra:`, error);
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

  const shutdown = async (signal: string) => {
    console.log(`[${config.serviceName}] Received ${signal}, shutting down gracefully...`);
    await client.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

initializeScheduler().catch(error => {
  console.error('[scheduler] Failed to initialize:', error);
  process.exit(1);
});