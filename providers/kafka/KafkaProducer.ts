import type { IEventBus } from '../../core/interfaces/IEventBus.js';
import { getKafkaClient } from './KafkaClient.js';

export type PublishOptions = {
  key?: string;
  headers?: Record<string, string>;
};

function approxBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export class KafkaProducer implements IEventBus {
  private readonly producer = getKafkaClient().producer();

  async publish(topic: string, event: unknown, options?: PublishOptions): Promise<void> {
    const serialized = JSON.stringify(event);
    // Upstash hard limit is ~1MB; keep a safety margin.
    if (approxBytes(serialized) > 900_000) {
      throw new Error(`Kafka message too large for topic ${topic}`);
    }

    await this.producer.produce(topic, serialized, {
      key: options?.key,
      headers: options?.headers
        ? Object.entries(options.headers).map(([key, value]) => ({ key, value }))
        : undefined
    });
  }

  async publishMany(
    events: Array<{ topic: string; event: unknown; key?: string; headers?: Record<string, string> }>
  ): Promise<void> {
    const requests = events.map(item => {
      const serialized = JSON.stringify(item.event);
      if (approxBytes(serialized) > 900_000) {
        throw new Error(`Kafka message too large for topic ${item.topic}`);
      }

      return {
        topic: item.topic,
        value: serialized,
        key: item.key,
        headers: item.headers
          ? Object.entries(item.headers).map(([key, value]) => ({ key, value }))
          : undefined
      };
    });

    await this.producer.produceMany(requests);
  }
}
