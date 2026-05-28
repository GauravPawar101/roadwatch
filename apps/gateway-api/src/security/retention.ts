import { getEnv } from '../env.js';
import { pool } from '../postgres.js';

function isMissingRelationError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as any).code === '42P01';
}

export function startRetentionJobs(): void {
  const env = getEnv();

  // Keep extremely simple: one daily sweep. No sleeps; rely on setInterval.
  const enabled = env.NODE_ENV !== 'test';
  if (!enabled) return;

  const runSweepSafely = async () => {
    try {
      await runRetentionSweep();
    } catch (e) {
      if (isMissingRelationError(e)) {
        console.warn('[retention] skipped sweep: notification tables are not migrated yet');
        return;
      }
      throw e;
    }
  };

  // Run once on boot, then daily.
  void runSweepSafely().catch((e) => console.error('[retention] initial sweep failed', e));

  const dayMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    void runSweepSafely().catch((e) => console.error('[retention] sweep failed', e));
  }, dayMs);
}

async function runRetentionSweep(): Promise<void> {
  // OTP sessions: handled by Redis TTL and explicit removal on consumption.
  // No DB cleanup required when OTPs are stored in Redis.

  // Notification deliveries: keep 90 days.
  const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await pool.query(
    `DELETE FROM notification_deliveries WHERE created_at < $1`,
    [cutoff90]
  );

  // Notification inbox/history: keep 180 days.
  const cutoff180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  await pool.query(
    `DELETE FROM notification_inbox WHERE created_at < $1`,
    [cutoff180]
  );

  // Notifications table: keep 180 days if unreferenced.
  await pool.query(
    `DELETE FROM notifications
     WHERE created_at < $1
     AND id NOT IN (SELECT DISTINCT notification_id FROM notification_inbox)
     AND id NOT IN (SELECT DISTINCT notification_id FROM notification_deliveries)`,
    [cutoff180]
  );

  // Audit log: keep 3 years (adjust per policy).
  const cutoff3y = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000);
  await pool.query(
    `DELETE FROM audit_log WHERE created_at < $1`,
    [cutoff3y]
  );
}