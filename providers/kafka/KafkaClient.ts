import { Kafka as KafkaJS } from 'kafkajs';
import { getLocalKafkaBrokers } from './config.js';

let kafkaSingleton: KafkaJS | null = null;

export function getKafkaClient(): KafkaJS {
  if (kafkaSingleton) return kafkaSingleton;
  const brokers = getLocalKafkaBrokers();
  if (!brokers) {
    throw new Error('Kafka is required but KAFKA_BROKER or KAFKA_BROKERS is not configured');
  }

  kafkaSingleton = new KafkaJS({ clientId: 'roadwatch', brokers });
  return kafkaSingleton;
}
