import { pool } from '../db.js';
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
  // OTP sessions: purge used/expired + anything older than 7 days.
  await pool.query(
    `DELETE FROM otp_sessions
     WHERE used = true
        OR expires_at < now()
        OR created_at < now() - interval '7 days';`
  );

  // Notification deliveries: keep 90 days.
  await pool.query(
    `DELETE FROM notification_deliveries
     WHERE created_at < now() - interval '90 days';`
  );

  // Notification inbox/history: keep 180 days.
  await pool.query(
    `DELETE FROM notification_inbox
     WHERE created_at < now() - interval '180 days';`
  );

  // Notifications table: keep 180 days if unreferenced.
  await pool.query(
    `DELETE FROM notifications n
     WHERE n.created_at < now() - interval '180 days'
       AND NOT EXISTS (
         SELECT 1 FROM notification_inbox i WHERE i.notification_id = n.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM notification_deliveries d WHERE d.notification_id = n.id
       );`
  );

  // Audit log: keep 3 years (adjust per policy).
  await pool.query(
    `DELETE FROM audit_log
     WHERE created_at < now() - interval '3 years';`
  );
}
