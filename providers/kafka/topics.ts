export const KafkaTopics = {
  complaintSubmitted: 'complaint.submitted',
  complaintAnchored: 'complaint.anchored',
  complaintStatusChanged: 'complaint.status.changed',

  mediaCaptured: 'media.captured',
  mediaCompressed: 'media.compressed',
  mediaUploaded: 'media.uploaded',
  mediaAnalyzed: 'media.analyzed',

  escalationDue: 'escalation.due',
  escalationSent: 'escalation.sent',

  fabricEvents: 'fabric.events',
  authorityAction: 'authority.action',

  notificationSend: 'notification.send',

  dlq: 'dlq.events'
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

export type BaseEvent = {
  idempotencyKey: string;
  occurredAt: string; // ISO-8601
  version: number;
};

export type ComplaintSubmittedEvent = BaseEvent & {
  type: 'complaint.submitted';
  complaintId: string;
  district: string;
  zone: string;
  lat?: number;
  lng?: number;
  description: string;
};

export type ComplaintAnchoredEvent = BaseEvent & {
  type: 'complaint.anchored';
  complaintId: string;
  merkleRoot: string; // hex
  merkleProof: Array<{ direction: 'left' | 'right'; hash: string }>;
  fabricTxId: string;
  batchId: string;
};

export type ComplaintStatusChangedEvent = BaseEvent & {
  type: 'complaint.status.changed';
  complaintId: string;
  fromStatus: string;
  toStatus: string;
  changedBy: { actorType: 'authority' | 'system'; actorId?: string };
};

export type MediaCapturedEvent = BaseEvent & {
  type: 'media.captured';
  complaintId: string;
  mediaId: string;
  mimeType: string;
};

export type MediaCompressedEvent = BaseEvent & {
  type: 'media.compressed';
  complaintId: string;
  mediaId: string;
  codec: string;
  byteLength: number;
};

export type MediaUploadedEvent = BaseEvent & {
  type: 'media.uploaded';
  complaintId: string;
  mediaId: string;
  storageProvider: 'pinata' | 'unknown';
  cid: string;
};

export type MediaAnalyzedEvent = BaseEvent & {
  type: 'media.analyzed';
  complaintId: string;
  mediaId: string;
  model: string;
  classification: string;
  confidence?: number;
};

export type EscalationDueEvent = BaseEvent & {
  type: 'escalation.due';
  complaintId: string;
  reason: string;
};

export type EscalationSentEvent = BaseEvent & {
  type: 'escalation.sent';
  complaintId: string;
  channel: 'sms' | 'push' | 'email' | 'unknown';
  target: string;
};

export type FabricEventsEvent = BaseEvent & {
  type: 'fabric.events';
  fabricTxId: string;
  eventName: string;
  payload?: unknown;
};

export type NotificationSendEvent = BaseEvent & {
  type: 'notification.send';
  channels: Array<'sms' | 'push' | 'email'>;
  template: string;
  to: { phone?: string; deviceToken?: string; email?: string };
  params: Record<string, string>;
  priority?: 'low' | 'normal' | 'high';
};

export type AuthorityActionEvent = BaseEvent & {
  type: 'authority.action';
  action: string;
  complaintId?: string;
  actorId?: string;
  payload?: unknown;
};

export type DlqEvent = BaseEvent & {
  type: 'dlq.events';
  originalTopic: string;
  consumerId: string;
  attempts: number;
  error: string;
  rawMessage: unknown;
};

export type TopicPayloadMap = {
  [KafkaTopics.complaintSubmitted]: ComplaintSubmittedEvent;
  [KafkaTopics.complaintAnchored]: ComplaintAnchoredEvent;
  [KafkaTopics.complaintStatusChanged]: ComplaintStatusChangedEvent;

  [KafkaTopics.mediaCaptured]: MediaCapturedEvent;
  [KafkaTopics.mediaCompressed]: MediaCompressedEvent;
  [KafkaTopics.mediaUploaded]: MediaUploadedEvent;
  [KafkaTopics.mediaAnalyzed]: MediaAnalyzedEvent;

  [KafkaTopics.escalationDue]: EscalationDueEvent;
  [KafkaTopics.escalationSent]: EscalationSentEvent;

  [KafkaTopics.fabricEvents]: FabricEventsEvent;
  [KafkaTopics.notificationSend]: NotificationSendEvent;
  [KafkaTopics.authorityAction]: AuthorityActionEvent;

  [KafkaTopics.dlq]: DlqEvent;
};
