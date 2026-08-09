import { Kafka as KafkaJS, Partitioners } from 'kafkajs';
import { getPublishClustersForTopic } from './clusters.js';
import { getEventsKafkaBrokers, getHlfKafkaBrokers } from './config.js';
export class KafkaProducer {
    clusterProducers = new Map();
    brokersForCluster(cluster) {
        const brokers = cluster === 'hlf' ? getHlfKafkaBrokers() : getEventsKafkaBrokers();
        if (!brokers) {
            throw new Error(cluster === 'hlf'
                ? 'HLF Kafka is required but KAFKA_HLF_BROKERS is not set'
                : 'Events Kafka is required but KAFKA_EVENTS_BROKERS is not set');
        }
        return brokers;
    }
    async ensureClusterConnected(cluster) {
        const existing = this.clusterProducers.get(cluster);
        if (existing?.connected)
            return existing;
        const brokers = this.brokersForCluster(cluster);
        const entry = existing ?? {
            producer: new KafkaJS({ clientId: `roadwatch-${cluster}`, brokers }).producer({
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
    async sendToCluster(cluster, topic, serialized, options) {
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
    async publish(topic, event, options) {
        const serialized = JSON.stringify(event);
        const clusters = getPublishClustersForTopic(topic);
        await Promise.all(clusters.map(cluster => this.sendToCluster(cluster, topic, serialized, options)));
    }
    async publishMany(events) {
        const grouped = new Map();
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
        await Promise.all(Array.from(grouped.entries()).flatMap(([cluster, byTopic]) => Array.from(byTopic.entries()).map(async ([topic, messages]) => {
            const { producer } = await this.ensureClusterConnected(cluster);
            await producer.send({ topic, messages });
        })));
    }
    async disconnect() {
        await Promise.all(Array.from(this.clusterProducers.values()).map(async (entry) => {
            if (entry.connected) {
                await entry.producer.disconnect();
            }
        }));
        this.clusterProducers.clear();
    }
}
