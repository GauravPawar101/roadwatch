import { Kafka } from '@upstash/kafka';
import { getUpstashKafkaConfig } from './config.js';

let kafkaSingleton: Kafka | null = null;

export function getKafkaClient(): Kafka {
  if (kafkaSingleton) return kafkaSingleton;
  const { url, username, password } = getUpstashKafkaConfig();
  kafkaSingleton = new Kafka({ url, username, password });
  return kafkaSingleton;
}
