import { Kafka } from '@upstash/kafka';
import { getKafkaConfig } from './config.js';

let kafkaSingleton: Kafka | null = null;

export function getKafkaClient(): Kafka {
  if (kafkaSingleton) return kafkaSingleton;
  const { url, username, password } = getKafkaConfig();
  kafkaSingleton = new Kafka({ url, username, password });
  return kafkaSingleton;
}
