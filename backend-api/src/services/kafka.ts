export type KafkaPublishOptions = {
  key?: string;
  headers?: Record<string, string>;
};

import { KafkaProducer } from '../../../providers/kafka/KafkaProducer.js';

const kafkaProducer = new KafkaProducer();

/** Emits a complaint event using local Kafka brokers. */
export async function emitComplaintEvent(
  event: unknown,
  topic = process.env.KAFKA_TOPIC_COMPLAINTS?.trim() || 'complaint-submitted',
  options: KafkaPublishOptions = {}
) {
  await kafkaProducer.publish(topic, event, options);
}
