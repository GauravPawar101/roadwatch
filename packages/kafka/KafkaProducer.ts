import { Kafka as KafkaJS, Partitioners } from 'kafkajs';
import type { IEventBus, PublishOptions } from '@roadwatch/core';
import { type KafkaCluster, getPublishClustersForTopic } from './clusters.js';
import { getKafkaClientOptions } from './config.js';

type ClusterProducer = {
  producer: ReturnType<KafkaJS['producer']>;
  connected: boolean;
};

export class KafkaProducer implements IEventBus {
  private readonly clusterProducers = new Map<KafkaCluster, ClusterProducer>();

  private async ensureClusterConnected(cluster: KafkaCluster): Promise<ClusterProducer> {
    const existing = this.clusterProducers.get(cluster);
    if (existing?.connected) return existing;

    // Throws with an actionable message when the cluster has no brokers, or has
    // absent or partial SASL credentials.
    const options = getKafkaClientOptions(cluster, `roadwatch-${cluster}`);
    const entry = existing ?? {
      producer: new KafkaJS(options).producer({
        createPartitioner: Partitioners.LegacyPartitioner
      }),
      connected: false
    };

    if (!entry.connected) {
      await entry.producer.connect();
      entry.connected = true;
    }

    this.clusterProducers.set(cluster, entry);
    return entry;
  }

  private async sendToCluster(
    cluster: KafkaCluster,
    topic: string,
    serialized: string,
    options?: PublishOptions
  ): Promise<void> {
    const { producer } = await this.ensureClusterConnected(cluster);
    await producer.send({
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

  async publish(topic: string, event: unknown, options?: PublishOptions): Promise<void> {
    const serialized = JSON.stringify(event);
    const clusters = getPublishClustersForTopic(topic);

    await Promise.all(clusters.map(cluster => this.sendToCluster(cluster, topic, serialized, options)));
  }

  async publishMany(
    events: Array<{ topic: string; event: unknown; key?: string; headers?: Record<string, string> }>
  ): Promise<void> {
    const grouped = new Map<KafkaCluster, Map<string, Array<{ value: string; key?: string; headers?: Record<string, string> }>>>();

    for (const item of events) {
      const serialized = JSON.stringify(item.event);
      const message = { value: serialized, key: item.key, headers: item.headers };

      for (const cluster of getPublishClustersForTopic(item.topic)) {
        const byTopic = grouped.get(cluster) ?? new Map();
        const list = byTopic.get(item.topic) ?? [];
        list.push(message);
        byTopic.set(item.topic, list);
        grouped.set(cluster, byTopic);
      }
    }

    await Promise.all(
      Array.from(grouped.entries()).flatMap(([cluster, byTopic]) =>
        Array.from(byTopic.entries()).map(async ([topic, messages]) => {
          const { producer } = await this.ensureClusterConnected(cluster);
          await producer.send({ topic, messages });
        })
      )
    );
  }

  async disconnect(): Promise<void> {
    await Promise.all(
      Array.from(this.clusterProducers.values()).map(async entry => {
        if (entry.connected) {
          await entry.producer.disconnect();
        }
      })
    );
    this.clusterProducers.clear();
  }
}
