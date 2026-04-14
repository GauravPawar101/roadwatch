export type NotificationType =
  | 'new_complaint'
  | 'status_change'
  | 'assignment'
  | 'escalation'
  | 'sla_warning'
  | 'resolved';

export type NotificationChannel = 'IN_APP' | 'FCM' | 'SMS' | 'WHATSAPP';

export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export type AuthorityBatchingPreference = 'IMMEDIATE' | 'DAILY_DIGEST';

export type DoNotDisturb = {
  enabled: boolean;
  startMinutes: number; // 0..1439
  endMinutes: number; // 0..1439
  timeZone: string; // IANA, e.g. 'Asia/Kolkata'
};

export type NotificationPreferences = {
  userId: string;
  enabledChannels: NotificationChannel[];
  doNotDisturb: DoNotDisturb;
  authorityBatching: AuthorityBatchingPreference;
  digestMinutes: number; // 0..1439 (local time)
};

export type NotificationAudience =
  | { kind: 'user'; userId: string }
  | { kind: 'jurisdiction'; district: string; zone?: string }
  | { kind: 'road'; roadId: string };

export type NotificationMessage = {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  audience: NotificationAudience;
  critical?: boolean; // bypasses DND + batching
};

const FCM_TOPIC_ALLOWED = /[A-Za-z0-9-_.~%]/;

export function sanitizeFcmTopicSegment(input: string): string {
  let out = '';
  for (const ch of input.trim()) {
    out += FCM_TOPIC_ALLOWED.test(ch) ? ch : '_';
  }
  return out.length ? out : '_';
}

export function fcmTopicForUser(userId: string): string {
  return `rw.user.${sanitizeFcmTopicSegment(userId)}`;
}

export function fcmTopicForJurisdiction(params: { district: string; zone?: string }): string {
  const d = sanitizeFcmTopicSegment(params.district);
  const z = sanitizeFcmTopicSegment(params.zone ?? 'ALL');
  return `rw.jurisdiction.${d}.${z}`;
}

export function fcmTopicForRoad(roadId: string): string {
  return `rw.road.${sanitizeFcmTopicSegment(roadId)}`;
}

export function fcmTopicsForAudience(audience: NotificationAudience): string[] {
  switch (audience.kind) {
    case 'user':
      return [fcmTopicForUser(audience.userId)];
    case 'jurisdiction':
      return [fcmTopicForJurisdiction({ district: audience.district, zone: audience.zone })];
    case 'road':
      return [fcmTopicForRoad(audience.roadId)];
    default: {
      const _exhaustive: never = audience;
      return _exhaustive;
    }
  }
}

export function getMinutesInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export function isWithinQuietHours(params: { now: Date; dnd: DoNotDisturb }): boolean {
  if (!params.dnd.enabled) return false;
  const nowMinutes = getMinutesInTimeZone(params.now, params.dnd.timeZone);
  const start = params.dnd.startMinutes;
  const end = params.dnd.endMinutes;

  if (start === end) return false;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

export function minutesUntilQuietEnds(params: { now: Date; dnd: DoNotDisturb }): number {
  const nowMinutes = getMinutesInTimeZone(params.now, params.dnd.timeZone);
  const start = params.dnd.startMinutes;
  const end = params.dnd.endMinutes;

  if (start === end) return 0;

  if (start < end) {
    if (nowMinutes < end) return end - nowMinutes;
    return 0;
  }

  if (nowMinutes >= start) return 1440 - nowMinutes + end;
  return end - nowMinutes;
}

export function minutesUntilNextDigest(params: { now: Date; timeZone: string; digestMinutes: number }): number {
  const nowMinutes = getMinutesInTimeZone(params.now, params.timeZone);
  const target = params.digestMinutes;
  const delta = target - nowMinutes;
  return delta > 0 ? delta : 1440 + delta;
}
