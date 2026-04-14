import { pool } from '../db.js';
import { getEnv } from '../env.js';
import { decryptPhone } from '../security/phone.js';
import type { NotificationChannel, NotificationDeliveryStatus } from './domain.js';
import {
    isWithinQuietHours,
    minutesUntilNextDigest,
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
  return row.critical;
}

function computeNextSchedule(params: {
  now: Date;
  row: DeliveryRow;
}): Date {
  const now = params.now;
  const dnd = {
    enabled: params.row.dnd_enabled,
    startMinutes: params.row.dnd_start_minutes,
    endMinutes: params.row.dnd_end_minutes,
    timeZone: params.row.time_zone
  };

  if (isCriticalOrBypass(params.row)) return now;

  if (isWithinQuietHours({ now, dnd })) {
    const deltaMin = minutesUntilQuietEnds({ now, dnd });
    return new Date(now.getTime() + deltaMin * 60_000);
  }

  if (params.row.role !== 'CE' && params.row.role !== 'EE') return now;
  if (params.row.authority_batching !== 'DAILY_DIGEST') return now;

  const deltaMin = minutesUntilNextDigest({ now, timeZone: params.row.time_zone, digestMinutes: params.row.digest_minutes });
  return new Date(now.getTime() + deltaMin * 60_000);
}

export function startNotificationDispatcher(): void {
  const env = getEnv();
  const enabled = env.NOTIFICATIONS_DISPATCHER_ENABLED === 'true';
  if (!enabled) {
    return;
  }

  const intervalMs = Math.max(10_000, Number(env.NOTIFICATIONS_DISPATCHER_INTERVAL_MS ?? '60000'));

  setInterval(() => {
    dispatchDueDeliveries().catch((e) => {
      console.error('[notifications] dispatcher failed', e);
    });
  }, intervalMs);
}

async function dispatchDueDeliveries(): Promise<void> {
  const now = new Date();

  // Fetch due deliveries with prefs + user details.
  const r = await pool.query<DeliveryRow>(
    `
    SELECT
      d.id,
      d.user_id,
      u.phone_enc,
      u.phone_masked,
      u.phone as phone_legacy,
      u.role,
      u.districts,
      u.zones,
      d.channel,
      d.scheduled_for,
      d.batch_key,
      n.id as notification_id,
      n.title,
      n.body,
      n.data,
      n.critical,
      n.district,
      n.zone,
      n.road_id,
      p.enabled_channels,
      p.dnd_enabled,
      p.dnd_start_minutes,
      p.dnd_end_minutes,
      p.time_zone,
      p.authority_batching,
      p.digest_minutes
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    JOIN users u ON u.id = d.user_id
    LEFT JOIN notification_preferences p ON p.user_id = d.user_id
    WHERE d.status = 'PENDING' AND d.scheduled_for <= now()
    ORDER BY d.scheduled_for ASC
    LIMIT 100;
    `
  );

  const digestGroups = new Map<string, DeliveryRow[]>();
  const immediateRows: DeliveryRow[] = [];

  for (const row of r.rows) {
    if (row.batch_key) {
      const groupKey = `${row.user_id}:${row.channel}:${row.batch_key}`;
      const existing = digestGroups.get(groupKey);
      if (existing) existing.push(row);
      else digestGroups.set(groupKey, [row]);
    } else {
      immediateRows.push(row);
    }
  }

  for (const row of immediateRows) {
    await processSingleDelivery({ now, row });
  }

  for (const rows of digestGroups.values()) {
    await processDigestGroup({ now, rows });
  }
}

async function processSingleDelivery(params: { now: Date; row: DeliveryRow }): Promise<void> {
  const { now, row } = params;
  const enabledChannels = Array.isArray(row.enabled_channels) ? row.enabled_channels : ['IN_APP', 'FCM'];
  if (!enabledChannels.includes(row.channel)) {
    await markDelivery(row.id, 'SKIPPED', null);
    return;
  }

  const next = computeNextSchedule({ now, row });
  if (next.getTime() - now.getTime() > 30_000) {
    await pool.query(`UPDATE notification_deliveries SET scheduled_for = $1 WHERE id = $2;`, [next, row.id]);
    return;
  }

  try {
    const phone = row.phone_enc ? decryptPhone(row.phone_enc) : (row.phone_legacy ?? row.phone_masked ?? '');
    if (!phone) throw new Error('User phone not available for delivery');
    await sendViaChannel({
      channel: row.channel,
      phone,
      title: row.title,
      body: row.body,
      data: row.data,
      userId: row.user_id,
      district: row.district,
      zone: row.zone,
      roadId: row.road_id
    });
    await markDelivery(row.id, 'SENT', null);
  } catch (e: any) {
    await markDelivery(row.id, 'FAILED', e?.message ?? 'Send failed');
  }
}

async function processDigestGroup(params: { now: Date; rows: DeliveryRow[] }): Promise<void> {
  const { now, rows } = params;
  const first = rows[0];
  if (!first) return;

  const enabledChannels = Array.isArray(first.enabled_channels) ? first.enabled_channels : ['IN_APP', 'FCM'];
  if (!enabledChannels.includes(first.channel)) {
    await pool.query(
      `UPDATE notification_deliveries SET status = 'SKIPPED' WHERE id = ANY($1::uuid[]);`,
      [rows.map((x) => x.id)]
    );
    return;
  }

  const next = computeNextSchedule({ now, row: first });
  if (next.getTime() - now.getTime() > 30_000) {
    await pool.query(
      `UPDATE notification_deliveries SET scheduled_for = $1 WHERE id = ANY($2::uuid[]);`,
      [next, rows.map((x) => x.id)]
    );
    return;
  }

  const count = rows.length;
  const sample = rows.slice(0, 5);
  const title = `Daily digest (${count})`;
  const bodyLines = sample.map((x) => `- ${x.title}`);
  const body = bodyLines.join('\n');

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
        notificationIds: rows.map((x) => x.notification_id)
      },
      userId: first.user_id,
      district: first.district,
      zone: first.zone,
      roadId: first.road_id
    });

    await pool.query(
      `UPDATE notification_deliveries SET status = 'SENT', sent_at = now() WHERE id = ANY($1::uuid[]);`,
      [rows.map((x) => x.id)]
    );
  } catch (e: any) {
    const msg = e?.message ?? 'Send failed';
    await pool.query(
      `UPDATE notification_deliveries SET status = 'FAILED', error = $1 WHERE id = ANY($2::uuid[]);`,
      [msg, rows.map((x) => x.id)]
    );
  }
}

async function markDelivery(id: string, status: NotificationDeliveryStatus, error: string | null) {
  await pool.query(
    `UPDATE notification_deliveries SET status = $1, sent_at = CASE WHEN $1 = 'SENT' THEN now() ELSE sent_at END, error = $2 WHERE id = $3;`,
    [status, error, id]
  );
}

async function markDeliveries(ids: string[], status: NotificationDeliveryStatus, error: string | null) {
  await pool.query(
    `UPDATE notification_deliveries
     SET status = $1,
         sent_at = CASE WHEN $1 = 'SENT' THEN now() ELSE sent_at END,
         error = $2
     WHERE id = ANY($3::uuid[]);`,
    [status, error, ids]
  );
}
