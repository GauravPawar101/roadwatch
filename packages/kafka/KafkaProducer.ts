import { Kafka as KafkaJS, Partitioners } from 'kafkajs';
import type { IEventBus } from '@roadwatch/core/src/interfaces/IEventBus.js';
import { getLocalKafkaBrokers } from './config.js';

export type PublishOptions = {
  key?: string;
  headers?: Record<string, string>;
};

function approxBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export class KafkaProducer implements IEventBus {
  private localProducer: ReturnType<KafkaJS['producer']> | null = null;
  private localConnected = false;

  private async ensureLocalConnected(): Promise<void> {
    if (this.localConnected) return;

    const brokers = getLocalKafkaBrokers();
    if (!brokers) {
      throw new Error('Kafka is required but KAFKA_BROKER(S) is not set');
    }

    if (!this.localProducer) {
      const kafka = new KafkaJS({ clientId: 'roadwatch', brokers });
      this.localProducer = kafka.producer({
        createPartitioner: Partitioners.LegacyPartitioner
      });
    }

    await this.localProducer.connect();
    this.localConnected = true;
  }

  async publish(topic: string, event: unknown, options?: PublishOptions): Promise<void> {
    const serialized = JSON.stringify(event);

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

  async disconnect(): Promise<void> {
    if (!this.localProducer) {
      return;
    }

    if (this.localConnected) {
      await this.localProducer.disconnect();
    }

    this.localConnected = false;
    this.localProducer = null;
  }
}
