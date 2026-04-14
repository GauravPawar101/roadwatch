import { pool, type Role } from '../db.js';
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
  const existing = await pool.query<PrefRow>(
    `SELECT user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes
     FROM notification_preferences
     WHERE user_id = $1
     LIMIT 1;`,
    [userId]
  );

  const row = existing.rows[0];
  if (row) return mapPrefsRow(row);

  await pool.query(
    `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;`,
    [userId]
  );

  const created = await pool.query<PrefRow>(
    `SELECT user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes
     FROM notification_preferences
     WHERE user_id = $1
     LIMIT 1;`,
    [userId]
  );

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

  await pool.query(
    `UPDATE notification_preferences
     SET enabled_channels = $2,
         dnd_enabled = $3,
         dnd_start_minutes = $4,
         dnd_end_minutes = $5,
         time_zone = $6,
         authority_batching = $7,
         digest_minutes = $8,
         updated_at = now()
     WHERE user_id = $1;`,
    [
      userId,
      next.enabledChannels,
      next.doNotDisturb.enabled,
      next.doNotDisturb.startMinutes,
      next.doNotDisturb.endMinutes,
      next.doNotDisturb.timeZone,
      next.authorityBatching,
      next.digestMinutes
    ]
  );

  return next;
}

export async function listInbox(userId: string, limit: number): Promise<InboxItem[]> {
  const r = await pool.query(
    `
    SELECT
      i.id as inbox_id,
      n.id as notification_id,
      n.type,
      n.title,
      n.body,
      n.data,
      n.district,
      n.zone,
      n.road_id,
      n.critical,
      n.created_at,
      i.read_at
    FROM notification_inbox i
    JOIN notifications n ON n.id = i.notification_id
    WHERE i.user_id = $1
    ORDER BY i.created_at DESC
    LIMIT $2;
    `,
    [userId, limit]
  );

  return r.rows.map((row: any) => ({
    inboxId: row.inbox_id,
    id: row.notification_id,
    notifType: row.type,
    title: row.title,
    body: row.body,
    data: row.data ?? {},
    district: row.district ?? null,
    zone: row.zone ?? null,
    roadId: row.road_id ?? null,
    critical: Boolean(row.critical),
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null
  }));
}

export async function markInboxRead(userId: string, inboxId: string): Promise<void> {
  await pool.query(
    `UPDATE notification_inbox SET read_at = now() WHERE user_id = $1 AND id = $2;`,
    [userId, inboxId]
  );
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

  const created = await pool.query<{ id: string }>(
    `
    INSERT INTO notifications (type, title, body, data, district, zone, road_id, critical)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
    RETURNING id;
    `,
    [
      m.type,
      m.title,
      m.body,
      JSON.stringify(m.data ?? {}),
      m.audience.kind === 'jurisdiction' ? m.audience.district : null,
      m.audience.kind === 'jurisdiction' ? m.audience.zone ?? null : null,
      m.audience.kind === 'road' ? m.audience.roadId : null,
      Boolean(m.critical)
    ]
  );

  const notificationId = created.rows[0]!.id;

  const userIds = await resolveAudienceUsers(m.audience);
  for (const uid of userIds) {
    // In-app history entry
    const inbox = await pool.query<{ id: string }>(
      `INSERT INTO notification_inbox (user_id, notification_id) VALUES ($1, $2)
       ON CONFLICT (user_id, notification_id) DO NOTHING
       RETURNING id;`,
      [uid, notificationId]
    );

    const inboxId = inbox.rows[0]?.id;

    // Ensure prefs exists
    const prefs = await getOrCreatePreferences(uid);

    // Always create delivery rows for out-of-band channels; actual send happens in dispatcher.
    for (const ch of prefs.enabledChannels) {
      if (ch === 'IN_APP') continue;
      const scheduledFor = computeSchedule({
        now: new Date(),
        channel: ch,
        critical: Boolean(m.critical),
        prefs,
        role: null
      });

      await pool.query(
        `INSERT INTO notification_deliveries (user_id, notification_id, channel, scheduled_for, batch_key)
         VALUES ($1, $2, $3, $4, $5);`,
        [uid, notificationId, ch, scheduledFor, batchKey({ prefs, channel: ch, audience: m.audience })]
      );
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

    const r = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM users
      WHERE (role IN ('CE','EE'))
        AND (
          'ALL' = ANY(districts) OR $1 = ANY(districts)
        )
        AND (
          'ALL' = ANY(zones) OR $2 = ANY(zones)
        );
      `,
      [district, zone]
    );

    return r.rows.map((x) => x.id);
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
