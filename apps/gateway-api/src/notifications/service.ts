import crypto from 'crypto';
import { type Role } from '../db.js';
import { pool } from '../postgres.js';
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

async function getOrCreatePreferencesWithClient(client: { query: (text: string, params?: any[]) => Promise<any> }, userId: string): Promise<NotificationPreferences> {
  const existing = await client.query(
    `SELECT user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes
     FROM notification_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  const row = existing.rows[0] as PrefRow | undefined;
  if (row) return mapPrefsRow(row);

  await client.query(
    `INSERT INTO notification_preferences (
       user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes,
       time_zone, authority_batching, digest_minutes, created_at, updated_at
     ) VALUES (
       $1, $2, false, 0, 0, 'UTC', 'IMMEDIATE', 60, NOW(), NOW()
     )`,
    [userId, null]
  );

  const created = await client.query(
    `SELECT user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes
     FROM notification_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  return mapPrefsRow(created.rows[0] as PrefRow);
}

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
     LIMIT 1`,
    [userId]
  );
  const row = existing.rows[0];
  if (row) return mapPrefsRow(row);

  await pool.query(
    `INSERT INTO notification_preferences (
       user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, 
       time_zone, authority_batching, digest_minutes, created_at, updated_at
     ) VALUES (
       $1, $2, false, 0, 0, 'UTC', 'IMMEDIATE', 60, NOW(), NOW()
     )`,
    [userId, null]
  );

  const created = await pool.query<PrefRow>(
    `SELECT user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes, time_zone, authority_batching, digest_minutes 
     FROM notification_preferences 
     WHERE user_id = $1 
     LIMIT 1`,
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
     SET enabled_channels = $1, 
         dnd_enabled = $2, 
         dnd_start_minutes = $3, 
         dnd_end_minutes = $4, 
         time_zone = $5, 
         authority_batching = $6, 
         digest_minutes = $7, 
         updated_at = NOW() 
     WHERE user_id = $8`,
    [
      next.enabledChannels,
      next.doNotDisturb.enabled,
      next.doNotDisturb.startMinutes,
      next.doNotDisturb.endMinutes,
      next.doNotDisturb.timeZone,
      next.authorityBatching,
      next.digestMinutes,
      userId
    ]
  );

  return next;
}

export async function listInbox(userId: string, limit: number): Promise<InboxItem[]> {
  const inboxRows = await pool.query(
    `SELECT id, notification_id, read_at, created_at 
     FROM notification_inbox 
     WHERE user_id = $1 
     LIMIT $2`,
    [userId, limit]
  );
  
  const out: InboxItem[] = [];
  for (const row of inboxRows.rows) {
    const notification = await pool.query(
      `SELECT id, type, title, body, data, district, zone, road_id, critical, created_at 
       FROM notifications 
       WHERE id = $1 
       LIMIT 1`,
      [row.notification_id]
    );
    const nr = notification.rows[0];
    
    if (nr) {
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
  }
  return out;
}

export async function markInboxRead(userId: string, inboxId: string): Promise<void> {
  await pool.query(
    `UPDATE notification_inbox 
     SET read_at = NOW() 
     WHERE user_id = $1 AND id = $2`,
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
  const notificationId = crypto.randomUUID();
  const userIds = await resolveAudienceUsers(m.audience);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO notifications (id, type, title, body, data, district, zone, road_id, critical, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        notificationId,
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

    for (const uid of userIds) {
      const inboxId = crypto.randomUUID();
      await client.query(
        `INSERT INTO notification_inbox (id, user_id, notification_id, created_at) 
         VALUES ($1, $2, $3, NOW())`,
        [inboxId, uid, notificationId]
      );

      const prefs = await getOrCreatePreferencesWithClient(client, uid);

      for (const ch of prefs.enabledChannels) {
        if (ch === 'IN_APP') continue;
        const scheduledFor = computeSchedule({ now: new Date(), channel: ch, critical: Boolean(m.critical), prefs, role: null });
        
        await client.query(
          `INSERT INTO notification_deliveries (id, user_id, notification_id, channel, scheduled_for, batch_key, created_at) 
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [crypto.randomUUID(), uid, notificationId, ch, scheduledFor, batchKey({ prefs, channel: ch, audience: m.audience })]
        );
      }

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
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { notificationId, userIds };
}

async function resolveAudienceUsers(audience: NotificationAudience): Promise<string[]> {
  if (audience.kind === 'user') return [audience.userId];

  if (audience.kind === 'jurisdiction') {
    const district = audience.district;
    const zone = audience.zone ?? 'ALL';

    const candidates = await pool.query(
      `SELECT id, role, districts, zones 
       FROM users 
       WHERE role = ANY($1)`,
      [['CE', 'EE']]
    );
    
    return candidates.rows.filter((u: any) => {
      const ds: string[] = u.districts || [];
      const zs: string[] = u.zones || [];
      const okDistrict = ds.includes('ALL') || ds.includes(district);
      const okZone = zs.includes('ALL') || zs.includes(zone);
      return okDistrict && okZone;
    }).map((x: any) => x.id);
  }

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