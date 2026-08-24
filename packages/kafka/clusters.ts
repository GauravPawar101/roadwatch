import { KafkaTopics, type KafkaTopic } from './topics.js';

export type KafkaCluster = 'hlf' | 'events';

/** Dead-letter events are mirrored to both clusters for ops visibility. */
const DUAL_CLUSTER_TOPICS = new Set<string>([
  KafkaTopics.complaintSubmitted,
  KafkaTopics.complaintStatusChanged,
  KafkaTopics.dlq
]);

/** Topics consumed/produced only on the HLF backpressure cluster. */
const HLF_ONLY_TOPICS = new Set<string>([]);

/** Topics that must stay on the events cluster only (SLA, notifications, webhooks). */
const EVENTS_ONLY_TOPICS = new Set<string>([
  KafkaTopics.complaintAnchored,
  KafkaTopics.notificationSend,
  KafkaTopics.authorityAction,
  KafkaTopics.escalationDue,
  KafkaTopics.escalationSent,
  KafkaTopics.mediaCaptured,
  KafkaTopics.mediaCompressed,
  KafkaTopics.mediaUploaded,
  KafkaTopics.mediaAnalyzed,
  KafkaTopics.fabricEvents
]);

export function getPublishClustersForTopic(topic: string): KafkaCluster[] {
  if (DUAL_CLUSTER_TOPICS.has(topic)) return ['hlf', 'events'];
  if (HLF_ONLY_TOPICS.has(topic)) return ['hlf'];
  if (EVENTS_ONLY_TOPICS.has(topic)) return ['events'];
  return ['events'];
}

export function isKafkaTopic(topic: string): topic is KafkaTopic {
  return Object.values(KafkaTopics).includes(topic as KafkaTopic);
}
