import { KafkaProducer, KafkaTopics } from '@roadwatch/kafka';

export type KafkaPublishOptions = {
  key?: string;
  headers?: Record<string, string>;
};

const kafkaProducer = new KafkaProducer();

/**
 * Emits a complaint event to the canonical topic.
 * The topic parameter should always come from KafkaTopics to prevent string drift.
 */
export async function emitComplaintEvent(
  event: unknown,
  topic: string = KafkaTopics.complaintSubmitted,
  options: KafkaPublishOptions = {}
): Promise<void> {
  await kafkaProducer.publish(topic, event, options);
}
