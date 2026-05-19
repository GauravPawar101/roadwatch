import { execute } from '../cassandra.js';
import { getEnv } from '../env.js';

export function startRetentionJobs(): void {
  const env = getEnv();

  // Keep extremely simple: one daily sweep. No sleeps; rely on setInterval.
  const enabled = env.NODE_ENV !== 'test';
  if (!enabled) return;

  // Run once on boot, then daily.
  void runRetentionSweep().catch((e) => console.error('[retention] initial sweep failed', e));

  const dayMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    void runRetentionSweep().catch((e) => console.error('[retention] sweep failed', e));
  }, dayMs);
}

async function runRetentionSweep(): Promise<void> {
  // OTP sessions: handled by Redis TTL and explicit removal on consumption.
  // No DB cleanup required when OTPs are stored in Redis.

  // Notification deliveries: keep 90 days.
  // Cassandra: delete by selecting old ids then deleting per id.
  const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const oldDeliveries = await execute('SELECT id FROM notification_deliveries WHERE created_at < ? ALLOW FILTERING', [cutoff90], { prepare: true });
  for (const r of oldDeliveries.rows) await execute('DELETE FROM notification_deliveries WHERE id = ?', [r.id], { prepare: true });

  // Notification inbox/history: keep 180 days.
  const cutoff180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const oldInbox = await execute('SELECT id FROM notification_inbox WHERE created_at < ? ALLOW FILTERING', [cutoff180], { prepare: true });
  for (const r of oldInbox.rows) await execute('DELETE FROM notification_inbox WHERE id = ?', [r.id], { prepare: true });

  // Notifications table: keep 180 days if unreferenced.
  const oldNotifications = await execute('SELECT id FROM notifications WHERE created_at < ? ALLOW FILTERING', [cutoff180], { prepare: true });
  for (const n of oldNotifications.rows) {
    const inboxRef = await execute('SELECT id FROM notification_inbox WHERE notification_id = ? LIMIT 1', [n.id], { prepare: true });
    const delRef = await execute('SELECT id FROM notification_deliveries WHERE notification_id = ? LIMIT 1', [n.id], { prepare: true });
    if ((!inboxRef.rows || inboxRef.rows.length === 0) && (!delRef.rows || delRef.rows.length === 0)) {
      await execute('DELETE FROM notifications WHERE id = ?', [n.id], { prepare: true });
    }
  }

  // Audit log: keep 3 years (adjust per policy).
  const cutoff3y = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000);
  const oldAudit = await execute('SELECT id FROM audit_log WHERE created_at < ? ALLOW FILTERING', [cutoff3y], { prepare: true });
  for (const r of oldAudit.rows) await execute('DELETE FROM audit_log WHERE id = ?', [r.id], { prepare: true });
}
