import { Kafka as KafkaJS } from 'kafkajs';
import { getKafkaClientOptions, type KafkaEnv } from './config.js';
import type { KafkaClusterName } from '@roadwatch/core';

const clients = new Map<string, KafkaJS>();

/**
 * Returns a Kafka client for one cluster, carrying that cluster's TLS and SASL
 * configuration.
 *
 * Cached per cluster: the two clusters may point at different providers with
 * different credentials, so a single shared client cannot serve both. Caching
 * also keeps kafkajs' internal connection pools from being rebuilt per call.
 */
export function getKafkaClient(
  cluster: KafkaClusterName = 'events',
  env: KafkaEnv = process.env
): KafkaJS {
  const existing = clients.get(cluster);
  if (existing) return existing;

  const client = new KafkaJS(getKafkaClientOptions(cluster, `roadwatch-${cluster}`, env));
  clients.set(cluster, client);
  return client;
}

/** Test hook: drops cached clients so a new environment takes effect. */
export function resetKafkaClients(): void {
  clients.clear();
}
