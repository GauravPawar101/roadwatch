import { resolveKafkaEndpoint, type KafkaClusterName } from '@roadwatch/core';

export type KafkaEnv = NodeJS.ProcessEnv;

function parseBrokers(raw: string | undefined): string[] | null {
  if (!raw || raw.trim().length === 0) return null;
  const brokers = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return brokers.length > 0 ? brokers : null;
}

function brokersFor(cluster: KafkaClusterName, env: KafkaEnv): string[] | null {
  // Managed/cloud brokers are consulted first so a *_CLOUD_BROKERS value can
  // take effect even when the in-cluster KAFKA_*_BROKERS is also present.
  const cloud = parseBrokers(
    cluster === 'hlf'
      ? env.KAFKA_HLF_CLOUD_BROKERS ?? env.KAFKA_HLF_MANAGED_BROKERS
      : env.KAFKA_EVENTS_CLOUD_BROKERS ?? env.KAFKA_EVENTS_MANAGED_BROKERS
  );
  if (cloud) return cloud;

  const { brokers } = resolveKafkaEndpoint(cluster, env);
  return brokers.length > 0 ? brokers : null;
}

export function getKafkaConnectionMode(env: KafkaEnv = process.env): 'local' {
  if (getHlfKafkaBrokers(env) || getEventsKafkaBrokers(env) || getLocalKafkaBrokers(env)) {
    return 'local';
  }

  throw new Error(
    'Kafka is required but KAFKA_HLF_BROKERS, KAFKA_EVENTS_BROKERS, or KAFKA_BROKER(S) is not configured'
  );
}

/** HLF backpressure cluster — fabric-anchor ingestion only. */
export function getHlfKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return brokersFor('hlf', env) ?? parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER);
}

/** Operational events cluster — SLA, notifications, triggers, webhook fan-out. */
export function getEventsKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return brokersFor('events', env) ?? parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER);
}

/** @deprecated Prefer getHlfKafkaBrokers / getEventsKafkaBrokers. Defaults to events cluster. */
export function getLocalKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return getEventsKafkaBrokers(env) ?? parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER ?? '127.0.0.1:9095');
}
