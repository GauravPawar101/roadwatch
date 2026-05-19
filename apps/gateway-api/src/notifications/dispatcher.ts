import { execute } from '../cassandra.js';
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
  // Fetch due deliveries; join related rows in application code
  const dRes = await execute('SELECT id, user_id, channel, scheduled_for, batch_key, notification_id FROM notification_deliveries WHERE status = ? AND scheduled_for <= ? LIMIT ?', ['PENDING', new Date(), 100], { prepare: true });
  const digestGroups = new Map<string, DeliveryRow[]>();
  const immediateRows: DeliveryRow[] = [];

  for (const d of dRes.rows) {
    const nRes = await execute('SELECT id, title, body, data, critical, district, zone, road_id FROM notifications WHERE id = ? LIMIT 1', [d.notification_id], { prepare: true });
    const uRes = await execute('SELECT id, phone_enc, phone_masked, phone, role, districts, zones FROM users WHERE id = ? LIMIT 1', [d.user_id], { prepare: true });
    const pRes = await execute('SELECT enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes FROM notification_preferences WHERE user_id = ? LIMIT 1', [d.user_id], { prepare: true });
    const row: DeliveryRow = {
      id: d.id,
      user_id: d.user_id,
      phone_enc: uRes.rows[0]?.phone_enc ?? null,
      phone_masked: uRes.rows[0]?.phone_masked ?? null,
      phone_legacy: uRes.rows[0]?.phone ?? null,
      role: uRes.rows[0]?.role ?? 'CITIZEN',
      districts: uRes.rows[0]?.districts ?? [],
      zones: uRes.rows[0]?.zones ?? [],
      channel: d.channel,
      scheduled_for: d.scheduled_for,
      batch_key: d.batch_key,
      notification_id: d.notification_id,
      title: nRes.rows[0]?.title ?? '',
      body: nRes.rows[0]?.body ?? '',
      data: nRes.rows[0]?.data ?? {},
      critical: nRes.rows[0]?.critical ?? false,
      district: nRes.rows[0]?.district ?? null,
      zone: nRes.rows[0]?.zone ?? null,
      road_id: nRes.rows[0]?.road_id ?? null,
      enabled_channels: pRes.rows[0]?.enabled_channels ?? ['IN_APP', 'FCM'],
      dnd_enabled: pRes.rows[0]?.dnd_enabled ?? false,
      dnd_start_minutes: pRes.rows[0]?.dnd_start_minutes ?? 0,
      dnd_end_minutes: pRes.rows[0]?.dnd_end_minutes ?? 0,
      time_zone: pRes.rows[0]?.time_zone ?? 'UTC',
      authority_batching: pRes.rows[0]?.authority_batching ?? 'IMMEDIATE',
      digest_minutes: pRes.rows[0]?.digest_minutes ?? 60
    };

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
    await execute('UPDATE notification_deliveries SET scheduled_for = ? WHERE id = ?', [next, row.id], { prepare: true });
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
    for (const r of rows) await execute('UPDATE notification_deliveries SET status = ? WHERE id = ?', ['SKIPPED', r.id], { prepare: true });
    return;
  }

  const next = computeNextSchedule({ now, row: first });
    if (next.getTime() - now.getTime() > 30_000) {
    for (const r of rows) await execute('UPDATE notification_deliveries SET scheduled_for = ? WHERE id = ?', [next, r.id], { prepare: true });
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

    for (const r of rows) await execute('UPDATE notification_deliveries SET status = ?, sent_at = ? WHERE id = ?', ['SENT', new Date(), r.id], { prepare: true });
  } catch (e: any) {
    const msg = e?.message ?? 'Send failed';
    for (const r of rows) await execute('UPDATE notification_deliveries SET status = ?, error = ? WHERE id = ?', ['FAILED', msg, r.id], { prepare: true });
  }
}

async function markDelivery(id: string, status: NotificationDeliveryStatus, error: string | null) {
  await execute('UPDATE notification_deliveries SET status = ?, sent_at = ?, error = ? WHERE id = ?', [status, status === 'SENT' ? new Date() : null, error, id], { prepare: true });
}

async function markDeliveries(ids: string[], status: NotificationDeliveryStatus, error: string | null) {
  for (const id of ids) await execute('UPDATE notification_deliveries SET status = ?, sent_at = ?, error = ? WHERE id = ?', [status, status === 'SENT' ? new Date() : null, error, id], { prepare: true });
}
