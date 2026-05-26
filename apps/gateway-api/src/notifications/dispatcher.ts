import { pool } from '../postgres.js';
import { decryptPhone } from '../security/phone.js';
import type { NotificationChannel, NotificationDeliveryStatus } from './domain.js';
import {
  isWithinQuietHours,
  minutesUntilQuietEnds
} from './domain.js';
import { sendViaChannel } from './providers.js';

type DeliveryRow = {
  id: string;
  user_id: string;
  phone_enc: string | null;
  phone_masked: string | null;
  phone_legacy: string | null;
  role: string;
  districts: string[];
  zones: string[];
  channel: NotificationChannel;
  scheduled_for: Date;
  batch_key: string | null;
  notification_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  critical: boolean;
  district: string | null;
  zone: string | null;
  road_id: string | null;
  enabled_channels: string[];
  dnd_enabled: boolean;
  dnd_start_minutes: number;
  dnd_end_minutes: number;
  time_zone: string;
  authority_batching: 'IMMEDIATE' | 'DAILY_DIGEST';
  digest_minutes: number;
};

function isCriticalOrBypass(row: DeliveryRow): boolean {
  if (row.critical) return true;
  return false;
}

function isMissingRelationError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as any).code === '42P01';
}

export async function processImmediateDeliveries(): Promise<number> {
  const now = new Date();

  let pendingDeliveriesResult;
  try {
    pendingDeliveriesResult = await pool.query<DeliveryRow>(
      `SELECT 
         d.id, d.user_id, d.channel, d.scheduled_for, d.batch_key, d.notification_id,
         n.title, n.body, n.data, n.critical, n.district, n.zone, n.road_id,
         u.phone_enc, u.phone_masked, u.phone_legacy, u.role, u.districts, u.zones,
         p.enabled_channels, p.dnd_enabled, p.dnd_start_minutes, p.dnd_end_minutes, p.time_zone,
         p.authority_batching, p.digest_minutes
       FROM notification_deliveries d
       JOIN notifications n ON d.notification_id = n.id
       JOIN users u ON d.user_id = u.id
       JOIN notification_preferences p ON d.user_id = p.user_id
       WHERE d.status = 'PENDING' 
         AND d.batch_key IS NULL 
         AND d.scheduled_for <= $1
       LIMIT 100`,
      [now]
    );
  } catch (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }
  const pendingDeliveries = pendingDeliveriesResult.rows;

  let processedCount = 0;

  for (const row of pendingDeliveries) {
    if (!isCriticalOrBypass(row)) {
      const dnd = {
        enabled: row.dnd_enabled,
        startMinutes: row.dnd_start_minutes,
        endMinutes: row.dnd_end_minutes,
        timeZone: row.time_zone
      };

      if (isWithinQuietHours({ now, dnd })) {
        const deltaMin = minutesUntilQuietEnds({ now, dnd });
        const nextRun = new Date(now.getTime() + deltaMin * 60_000);
        
        await pool.query(
          `UPDATE notification_deliveries 
           SET scheduled_for = $1 
           WHERE id = $2`,
          [nextRun, row.id]
        );
        continue;
      }
    }

    try {
      const phone = row.phone_enc ? decryptPhone(row.phone_enc) : (row.phone_legacy ?? row.phone_masked ?? '');
      if (!phone) {
        throw new Error('User phone number is completely missing or unavailable');
      }

      await sendViaChannel({
        channel: row.channel,
        phone,
        title: row.title,
        body: row.body,
        data: (row.data as Record<string, unknown>) || {},
        userId: row.user_id,
        district: row.district,
        zone: row.zone,
        roadId: row.road_id
      });

      await markDelivery(row.id, 'SENT', null);
    } catch (e: any) {
      console.error(`[dispatcher] Failed to execute immediate send for delivery ${row.id}:`, e);
      await markDelivery(row.id, 'FAILED', e?.message ?? 'Immediate send execution failed');
    }

    processedCount++;
  }

  return processedCount;
}

export async function processBatchedDigests(): Promise<number> {
  const now = new Date();

  let readyBatchesResult;
  try {
    readyBatchesResult = await pool.query<{ batch_key: string | null }>(
      `SELECT batch_key 
       FROM notification_deliveries
       WHERE status = 'PENDING' 
         AND batch_key IS NOT NULL 
         AND scheduled_for <= $1
       GROUP BY batch_key
       LIMIT 20`,
      [now]
    );
  } catch (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }
  const readyBatches = readyBatchesResult.rows;

  let processedBatches = 0;

  for (const b of readyBatches) {
    const key = b.batch_key;
    if (!key) continue;

    const rowsResult = await pool.query<DeliveryRow>(
      `SELECT 
         d.id, d.user_id, d.channel, d.scheduled_for, d.batch_key, d.notification_id,
         n.title, n.body, n.data, n.critical, n.district, n.zone, n.road_id,
         u.phone_enc, u.phone_masked, u.phone_legacy, u.role, u.districts, u.zones,
         p.enabled_channels, p.dnd_enabled, p.dnd_start_minutes, p.dnd_end_minutes, p.time_zone,
         p.authority_batching, p.digest_minutes
       FROM notification_deliveries d
       JOIN notifications n ON d.notification_id = n.id
       JOIN users u ON d.user_id = u.id
       JOIN notification_preferences p ON d.user_id = p.user_id
       WHERE d.status = 'PENDING' 
         AND d.batch_key = $1
       ORDER BY d.created_at ASC`,
      [key]
    );
    const rows = rowsResult.rows;

    if (!rows.length) continue;

    const first = rows[0];
    if (!first) continue;
    if (!isCriticalOrBypass(first)) {
      const dnd = {
        enabled: first.dnd_enabled,
        startMinutes: first.dnd_start_minutes,
        endMinutes: first.dnd_end_minutes,
        timeZone: first.time_zone
      };

      if (isWithinQuietHours({ now, dnd })) {
        const deltaMin = minutesUntilQuietEnds({ now, dnd });
        const nextRun = new Date(now.getTime() + deltaMin * 60_000);
        
        await pool.query(
          `UPDATE notification_deliveries 
           SET scheduled_for = $1 
           WHERE batch_key = $2 AND status = 'PENDING'`,
          [nextRun, key]
        );
        continue;
      }
    }

    await dispatchDigestBatch(key, rows);
    processedBatches++;
  }

  return processedBatches;
}

async function dispatchDigestBatch(batchKey: string, rows: DeliveryRow[]): Promise<void> {
  const first = rows[0];
  if (!first) return;
  const count = rows.length;

  const title = `RoadWatch Digest: ${count} Updates`;
  const body = `You have received ${count} jurisdiction updates across your tracked alerts. Open the dashboard to see detail reports.`;

  try {
    const phone = first.phone_enc ? decryptPhone(first.phone_enc) : (first.phone_legacy ?? first.phone_masked ?? '');
    if (!phone) throw new Error('User phone not available for delivery');
    
    await sendViaChannel({
      channel: first.channel,
      phone,
      title,
      body,
      data: {
        kind: 'digest',
        count,
        notificationIds: rows.map((x: DeliveryRow) => x.notification_id)
      },
      userId: first.user_id,
      district: first.district,
      zone: first.zone,
      roadId: first.road_id
    });

    const deliveryIds = rows.map((r: DeliveryRow) => r.id);
    await pool.query(
      `UPDATE notification_deliveries 
       SET status = 'SENT', sent_at = NOW() 
       WHERE id = ANY($1)`,
      [deliveryIds]
    );
  } catch (e: any) {
    const msg = e?.message ?? 'Send failed';
    const deliveryIds = rows.map((r: DeliveryRow) => r.id);
    
    await pool.query(
      `UPDATE notification_deliveries 
       SET status = 'FAILED', error = $1 
       WHERE id = ANY($2)`,
      [msg, deliveryIds]
    );
  }
}

async function markDelivery(id: string, status: NotificationDeliveryStatus, error: string | null) {
  await pool.query(
    `UPDATE notification_deliveries 
     SET status = $1, 
         sent_at = CASE WHEN $1 = 'SENT' THEN NOW() ELSE NULL END, 
         error = $2 
     WHERE id = $3`,
    [status, error, id]
  );
}

async function markDeliveries(ids: string[], status: NotificationDeliveryStatus, error: string | null) {
  if (!ids.length) return;
  await pool.query(
    `UPDATE notification_deliveries 
     SET status = $1, 
         sent_at = CASE WHEN $1 = 'SENT' THEN NOW() ELSE NULL END, 
         error = $2 
     WHERE id = ANY($3)`,
    [status, error, ids]
  );
}

export function startNotificationDispatcher(): () => void {
  const intervalMs = Math.max(1000, Number(process.env.NOTIFICATION_DISPATCH_INTERVAL_MS ?? 10000));

  const tick = async () => {
    try {
      await processImmediateDeliveries();
      await processBatchedDigests();
    } catch (error) {
      console.error('[dispatcher] tick failed:', error instanceof Error ? error.message : String(error));
    }
  };

  void tick();
  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => clearInterval(handle);
}