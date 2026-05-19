import crypto from 'crypto';
import { execute } from '../cassandra.js';
import { type Role } from '../db.js';
import { broadcastNotificationEvent } from '../realtime/sse.js';
import type {
    NotificationAudience,
    NotificationChannel,
    NotificationMessage,
    NotificationPreferences,
    NotificationType
} from './domain.js';
import {
    fcmTopicsForAudience,
    isWithinQuietHours,
    minutesUntilNextDigest,
    minutesUntilQuietEnds
} from './domain.js';

type PrefRow = {
  user_id: string;
  enabled_channels: string[];
  dnd_enabled: boolean;
  dnd_start_minutes: number;
  dnd_end_minutes: number;
  time_zone: string;
  authority_batching: 'IMMEDIATE' | 'DAILY_DIGEST';
  digest_minutes: number;
};

export type InboxItem = {
  inboxId: string;
  id: string;
  notifType: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  district: string | null;
  zone: string | null;
  roadId: string | null;
  critical: boolean;
  createdAt: string;
  readAt: string | null;
};

export async function getOrCreatePreferences(userId: string): Promise<NotificationPreferences> {
  const existing = await execute('SELECT user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes FROM notification_preferences WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
  const row = existing.rows[0];
  if (row) return mapPrefsRow(row);

  await execute('INSERT INTO notification_preferences (user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [userId, null, false, 0, 0, 'UTC', 'IMMEDIATE', 60, new Date(), new Date()], { prepare: true });

  const created = await execute('SELECT user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes FROM notification_preferences WHERE user_id = ? LIMIT 1', [userId], { prepare: true });
  return mapPrefsRow(created.rows[0]!);
}

export async function updatePreferences(userId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const current = await getOrCreatePreferences(userId);

  const next: NotificationPreferences = {
    ...current,
    ...patch,
    enabledChannels: patch.enabledChannels ?? current.enabledChannels,
    doNotDisturb: patch.doNotDisturb ?? current.doNotDisturb,
    authorityBatching: patch.authorityBatching ?? current.authorityBatching,
    digestMinutes: patch.digestMinutes ?? current.digestMinutes
  };

  await execute('UPDATE notification_preferences SET enabled_channels = ?, dnd_enabled = ?, dnd_start_minutes = ?, dnd_end_minutes = ?, time_zone = ?, authority_batching = ?, digest_minutes = ?, updated_at = ? WHERE user_id = ?', [next.enabledChannels, next.doNotDisturb.enabled, next.doNotDisturb.startMinutes, next.doNotDisturb.endMinutes, next.doNotDisturb.timeZone, next.authorityBatching, next.digestMinutes, new Date(), userId], { prepare: true });

  return next;
}

export async function listInbox(userId: string, limit: number): Promise<InboxItem[]> {
  const inboxRows = await execute('SELECT id, notification_id, read_at, created_at FROM notification_inbox WHERE user_id = ? LIMIT ?', [userId, limit], { prepare: true });
  const out: InboxItem[] = [];
  for (const row of inboxRows.rows) {
    const n = await execute('SELECT id, type, title, body, data, district, zone, road_id, critical, created_at FROM notifications WHERE id = ? LIMIT 1', [row.notification_id], { prepare: true });
    const nr = n.rows[0];
    out.push({
      inboxId: row.id,
      id: nr.id,
      notifType: nr.type,
      title: nr.title,
      body: nr.body,
      data: nr.data ?? {},
      district: nr.district ?? null,
      zone: nr.zone ?? null,
      roadId: nr.road_id ?? null,
      critical: Boolean(nr.critical),
      createdAt: new Date(nr.created_at).toISOString(),
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null
    });
  }
  return out;
}

export async function markInboxRead(userId: string, inboxId: string): Promise<void> {
  await execute('UPDATE notification_inbox SET read_at = ? WHERE user_id = ? AND id = ?', [new Date(), userId, inboxId], { prepare: true });
}

export function topicsForUser(params: { userId: string; districts: string[]; zones: string[] }): {
  userTopic: string;
  jurisdictionTopics: string[];
} {
  const userTopic = fcmTopicsForAudience({ kind: 'user', userId: params.userId })[0]!;

  const districts = params.districts.includes('ALL') ? ['ALL'] : params.districts;
  const zones = params.zones.includes('ALL') ? ['ALL'] : params.zones;

  const topics = new Set<string>();
  for (const d of districts) {
    for (const z of zones) {
      topics.add(fcmTopicsForAudience({ kind: 'jurisdiction', district: d, zone: z })[0]!);
    }
  }

  return { userTopic, jurisdictionTopics: [...topics] };
}

export async function createAndFanoutNotification(params: {
  message: NotificationMessage;
}): Promise<{ notificationId: string; userIds: string[] }> {
  const m = params.message;

  const notificationId = crypto.randomUUID();
  await execute('INSERT INTO notifications (id, type, title, body, data, district, zone, road_id, critical, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [notificationId, m.type, m.title, m.body, JSON.stringify(m.data ?? {}), m.audience.kind === 'jurisdiction' ? m.audience.district : null, m.audience.kind === 'jurisdiction' ? m.audience.zone ?? null : null, m.audience.kind === 'road' ? m.audience.roadId : null, Boolean(m.critical), new Date()], { prepare: true });

  const userIds = await resolveAudienceUsers(m.audience);
  for (const uid of userIds) {
    // In-app history entry
    const inboxId = crypto.randomUUID();
    await execute('INSERT INTO notification_inbox (id, user_id, notification_id, created_at) VALUES (?, ?, ?, ?)', [inboxId, uid, notificationId, new Date()], { prepare: true });

    // Ensure prefs exists
    const prefs = await getOrCreatePreferences(uid);

    // Always create delivery rows for out-of-band channels; actual send happens in dispatcher.
    for (const ch of prefs.enabledChannels) {
      if (ch === 'IN_APP') continue;
      const scheduledFor = computeSchedule({ now: new Date(), channel: ch, critical: Boolean(m.critical), prefs, role: null });
      await execute('INSERT INTO notification_deliveries (id, user_id, notification_id, channel, scheduled_for, batch_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), uid, notificationId, ch, scheduledFor, batchKey({ prefs, channel: ch, audience: m.audience }), new Date()], { prepare: true });
    }

    if (inboxId) {
      broadcastNotificationEvent({
        userId: uid,
        district: m.audience.kind === 'jurisdiction' ? m.audience.district : null,
        zone: m.audience.kind === 'jurisdiction' ? (m.audience.zone ?? null) : null,
        event: {
          type: 'notification_created',
          notification: {
            inboxId,
            id: notificationId,
            notifType: m.type,
            title: m.title,
            body: m.body,
            district: m.audience.kind === 'jurisdiction' ? m.audience.district : null,
            zone: m.audience.kind === 'jurisdiction' ? (m.audience.zone ?? null) : null,
            roadId: m.audience.kind === 'road' ? m.audience.roadId : null,
            critical: Boolean(m.critical),
            createdAt: new Date().toISOString(),
            readAt: null
          }
        }
      });
    }
  }

  return { notificationId, userIds };
}

async function resolveAudienceUsers(audience: NotificationAudience): Promise<string[]> {
  if (audience.kind === 'user') return [audience.userId];

  if (audience.kind === 'jurisdiction') {
    const district = audience.district;
    const zone = audience.zone ?? 'ALL';

    // Select candidate users and filter in application code
    const candidates = await execute('SELECT id, role, districts, zones FROM users WHERE role IN ? ALLOW FILTERING', [['CE', 'EE']], { prepare: true });
    return (candidates.rows || []).filter((u: any) => {
      const ds: string[] = u.districts || [];
      const zs: string[] = u.zones || [];
      const okDistrict = ds.includes('ALL') || ds.includes(district);
      const okZone = zs.includes('ALL') || zs.includes(zone);
      return okDistrict && okZone;
    }).map((x: any) => x.id);
  }

  // Road audience: no global mapping without an explicit road->jurisdiction mapping; keep empty for now.
  return [];
}

function computeSchedule(params: {
  now: Date;
  channel: NotificationChannel;
  critical: boolean;
  prefs: NotificationPreferences;
  role: Role | null;
}): Date {
  if (params.critical) return params.now;

  const dnd = params.prefs.doNotDisturb;
  if (isWithinQuietHours({ now: params.now, dnd })) {
    const deltaMin = minutesUntilQuietEnds({ now: params.now, dnd });
    return new Date(params.now.getTime() + deltaMin * 60_000);
  }

  if (params.prefs.authorityBatching === 'DAILY_DIGEST') {
    const deltaMin = minutesUntilNextDigest({ now: params.now, timeZone: dnd.timeZone, digestMinutes: params.prefs.digestMinutes });
    return new Date(params.now.getTime() + deltaMin * 60_000);
  }

  return params.now;
}

function batchKey(params: {
  prefs: NotificationPreferences;
  channel: NotificationChannel;
  audience: NotificationAudience;
  critical?: boolean;
}): string | null {
  if (params.prefs.authorityBatching !== 'DAILY_DIGEST') return null;
  if (params.channel === 'IN_APP') return null;
  if (params.critical) return null;

  if (params.audience.kind === 'jurisdiction') {
    return `digest:${params.channel}:${params.audience.district}:${params.audience.zone ?? 'ALL'}`;
  }
  return `digest:${params.channel}:user`;
}

function mapPrefsRow(row: PrefRow): NotificationPreferences {
  return {
    userId: row.user_id,
    enabledChannels: (row.enabled_channels as NotificationChannel[]) ?? ['IN_APP', 'FCM'],
    doNotDisturb: {
      enabled: row.dnd_enabled,
      startMinutes: row.dnd_start_minutes,
      endMinutes: row.dnd_end_minutes,
      timeZone: row.time_zone
    },
    authorityBatching: row.authority_batching,
    digestMinutes: row.digest_minutes
  };
}
