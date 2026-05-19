import { Kafka as KafkaJS } from 'kafkajs';
import type { IEventBus } from '../../core/interfaces/IEventBus.js';
import { getKafkaClient } from './KafkaClient.js';
import { getKafkaConnectionMode, getLocalKafkaBrokers } from './config.js';

export type PublishOptions = {
  key?: string;
  headers?: Record<string, string>;
};

function approxBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export class KafkaProducer implements IEventBus {
  private readonly mode = getKafkaConnectionMode();
  private readonly upstashProducer = this.mode === 'upstash' ? getKafkaClient().producer() : null;
  private localProducer: ReturnType<KafkaJS['producer']> | null = null;
  private localConnected = false;

  private getMode(): 'upstash' | 'local' {
    return this.mode;
  }

  private async ensureLocalConnected(): Promise<void> {
    if (this.localConnected) return;

    const brokers = getLocalKafkaBrokers();
    if (!brokers) {
      throw new Error('Kafka is required but KAFKA_BROKER(S) is not set');
    }

    if (!this.localProducer) {
      const kafka = new KafkaJS({ clientId: 'roadwatch', brokers });
      this.localProducer = kafka.producer();
    }

    await this.localProducer.connect();
    this.localConnected = true;
  }

  async publish(topic: string, event: unknown, options?: PublishOptions): Promise<void> {
    const serialized = JSON.stringify(event);

    const mode = this.getMode();
    if (mode === 'upstash') {
      // Upstash hard limit is ~1MB; keep a safety margin.
      if (approxBytes(serialized) > 900_000) {
        throw new Error(`Kafka message too large for topic ${topic}`);
      }

      await this.upstashProducer!.produce(topic, serialized, {
        key: options?.key,
        headers: options?.headers
          ? Object.entries(options.headers).map(([key, value]) => ({ key, value }))
          : undefined
      });
      return;
    }

    await this.ensureLocalConnected();
    await this.localProducer!.send({
      topic,
      messages: [
        {
          value: serialized,
          key: options?.key,
          headers: options?.headers
        }
      ]
    });
  }

  async publishMany(
    events: Array<{ topic: string; event: unknown; key?: string; headers?: Record<string, string> }>
  ): Promise<void> {
    const mode = this.getMode();

    if (mode === 'upstash') {
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

      await this.upstashProducer!.produceMany(requests);
      return;
    }

    await this.ensureLocalConnected();

    const byTopic = new Map<
      string,
      Array<{ value: string; key?: string; headers?: Record<string, string> }>
    >();

    for (const item of events) {
      const serialized = JSON.stringify(item.event);
      const list = byTopic.get(item.topic) ?? [];
      list.push({ value: serialized, key: item.key, headers: item.headers });
      byTopic.set(item.topic, list);
    }

    await Promise.all(
      Array.from(byTopic.entries()).map(([topic, messages]) =>
        this.localProducer!.send({ topic, messages })
      )
    );
  }
}
