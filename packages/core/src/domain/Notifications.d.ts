export type NotificationType = 'new_complaint' | 'status_change' | 'escalation' | 'sla_warning' | 'resolved';
export type NotificationChannel = 'IN_APP' | 'FCM' | 'SMS' | 'WHATSAPP';
export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
export type AuthorityBatchingPreference = 'IMMEDIATE' | 'DAILY_DIGEST';
export type DoNotDisturb = {
    enabled: boolean;
    startMinutes: number;
    endMinutes: number;
    timeZone: string;
};
export type NotificationPreferences = {
    userId: string;
    enabledChannels: NotificationChannel[];
    doNotDisturb: DoNotDisturb;
    authorityBatching: AuthorityBatchingPreference;
    digestMinutes: number;
};
export type NotificationAudience = {
    kind: 'user';
    userId: string;
} | {
    kind: 'jurisdiction';
    district: string;
    zone?: string;
} | {
    kind: 'road';
    roadId: string;
};
export type NotificationMessage = {
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, string>;
    audience: NotificationAudience;
    critical?: boolean;
};
export declare function sanitizeFcmTopicSegment(input: string): string;
export declare function fcmTopicForUser(userId: string): string;
export declare function fcmTopicForJurisdiction(params: {
    district: string;
    zone?: string;
}): string;
export declare function fcmTopicForRoad(roadId: string): string;
export declare function fcmTopicsForAudience(audience: NotificationAudience): string[];
export declare function getMinutesInTimeZone(date: Date, timeZone: string): number;
export declare function isWithinQuietHours(params: {
    now: Date;
    dnd: DoNotDisturb;
}): boolean;
export declare function minutesUntilQuietEnds(params: {
    now: Date;
    dnd: DoNotDisturb;
}): number;
export declare function minutesUntilNextDigest(params: {
    now: Date;
    timeZone: string;
    digestMinutes: number;
}): number;
//# sourceMappingURL=Notifications.d.ts.map