import { KafkaProducer } from '@roadwatch/kafka';

let cached: KafkaProducer | null = null;

export function getKafkaProducer(): KafkaProducer {
  if (cached) return cached;
  cached = new KafkaProducer();
  return cached;
}
