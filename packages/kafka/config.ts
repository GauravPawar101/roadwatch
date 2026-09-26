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

/**
 * Single entry point for broker resolution.
 *
 * The precedence chain (managed/cloud -> cluster-specific -> legacy shared
 * alias) lives in @roadwatch/core. This function used to re-implement the
 * cloud tier and then call the resolver as well, so the order was stated twice
 * and could disagree with the services that resolve directly.
 */
function brokersFor(cluster: KafkaClusterName, env: KafkaEnv): string[] | null {
  const { brokers } = resolveKafkaEndpoint(cluster, env);
  if (brokers.length > 0) return brokers;

  // The resolver applies the legacy shared aliases to the events cluster only.
  // The HLF cluster historically accepted them too, so keep that behaviour
  // rather than silently changing which deployments resolve.
  if (cluster === 'hlf') {
    return parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER);
  }
  return null;
}

/**
 * Returns the connection mode, or throws when nothing is configured.
 *
 * The unconfigured check deliberately does not consult getLocalKafkaBrokers:
 * that helper carries a hardcoded 127.0.0.1:9095 fallback for local
 * development, so including it made this condition permanently true and the
 * error below unreachable. Callers that want "is anything configured at all"
 * must therefore be answered by the two cluster resolvers.
 */
export function getKafkaConnectionMode(env: KafkaEnv = process.env): 'local' {
  if (getHlfKafkaBrokers(env) || getEventsKafkaBrokers(env)) {
    return 'local';
  }

  throw new Error(
    'Kafka is required but not configured. For a managed cluster set ' +
      'KAFKA_EVENTS_CLOUD_BROKERS (or KAFKA_HLF_CLOUD_BROKERS); for an explicit ' +
      'endpoint set KAFKA_EVENTS_BROKERS / KAFKA_HLF_BROKERS; otherwise set ' +
      'KAFKA_BROKERS or KAFKA_BROKER.',
  );
}

/** HLF backpressure cluster — fabric-anchor ingestion only. */
export function getHlfKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return brokersFor('hlf', env);
}

/** Operational events cluster — SLA, notifications, triggers, webhook fan-out. */
export function getEventsKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return brokersFor('events', env);
}

/** @deprecated Prefer getHlfKafkaBrokers / getEventsKafkaBrokers. Defaults to events cluster. */
export function getLocalKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return getEventsKafkaBrokers(env) ?? parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER ?? '127.0.0.1:9095');
}
