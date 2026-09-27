import { resolveKafkaEndpoint, type KafkaClusterName } from '@roadwatch/core';
import type { SASLOptions } from 'kafkajs';

export type KafkaEnv = NodeJS.ProcessEnv;

/** SASL mechanisms kafkajs accepts, spelled exactly as it expects them. */
const SASL_MECHANISMS = ['plain', 'scram-sha-256', 'scram-sha-512'] as const;
export type SaslMechanism = (typeof SASL_MECHANISMS)[number];

export type KafkaClientOptions = {
  clientId: string;
  brokers: string[];
  ssl?: boolean | { ca: string };
  sasl?: SASLOptions;
};

function clean(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function truthy(raw: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((raw ?? '').trim().toLowerCase());
}

/**
 * Build the kafkajs client options for one cluster, including the credentials
 * that cluster needs.
 *
 * The client was previously constructed as `new Kafka({ clientId, brokers })`,
 * which cannot talk to any hosted Kafka: Confluent Cloud, Redpanda Cloud and
 * Aiven all require SASL over TLS and refuse plaintext connections outright.
 *
 * Credentials resolve per cluster so the two clusters can live in different
 * provider accounts with different keys. If *any* per-cluster credential is
 * present the whole set must be supplied per cluster — silently pairing one
 * cluster's username with another's password produces an authentication failure
 * that is hard to read, so it is reported as a configuration error instead.
 */
export function getKafkaClientOptions(
  cluster: KafkaClusterName,
  clientId: string,
  env: KafkaEnv = process.env
): KafkaClientOptions {
  const upper = cluster.toUpperCase();
  const brokers = cluster === 'hlf' ? getHlfKafkaBrokers(env) : getEventsKafkaBrokers(env);

  if (!brokers || brokers.length === 0) {
    throw new Error(
      cluster === 'hlf'
        ? 'HLF Kafka is required but KAFKA_HLF_CLOUD_BROKERS / KAFKA_HLF_BROKERS are not set'
        : 'Events Kafka is required but KAFKA_EVENTS_CLOUD_BROKERS / KAFKA_EVENTS_BROKERS are not set'
    );
  }

  const options: KafkaClientOptions = { clientId, brokers };

  // ── TLS ──────────────────────────────────────────────────────────────────
  const ca = clean(env[`KAFKA_${upper}_SSL_CA`]) ?? clean(env.KAFKA_SSL_CA);
  const sslOn = truthy(env[`KAFKA_${upper}_SSL`]) || (env[`KAFKA_${upper}_SSL`] === undefined && truthy(env.KAFKA_SSL));
  if (ca) {
    options.ssl = { ca };
  } else if (sslOn) {
    options.ssl = true;
  }

  // ── SASL ─────────────────────────────────────────────────────────────────
  // Resolved field by field so a cluster can override just its key and secret
  // while inheriting the shared mechanism (the common case: two accounts on
  // the same provider, differing only in API key).
  const mechanism = clean(env[`KAFKA_${upper}_SASL_MECHANISM`]) ?? clean(env.KAFKA_SASL_MECHANISM);
  const specificUser = clean(env[`KAFKA_${upper}_SASL_USER`]);
  const specificPassword = clean(env[`KAFKA_${upper}_SASL_PASSWORD`]);
  const sharedUser = clean(env.KAFKA_SASL_USER);
  const sharedPassword = clean(env.KAFKA_SASL_PASSWORD);

  // A username from one identity paired with a password from another
  // authenticates as the wrong principal and fails at the broker with a message
  // that does not point at the configuration error. Only reject that specific
  // cross-pairing; a consistent tier for both is fine.
  const userFromSpecific = Boolean(specificUser);
  const passwordFromSpecific = Boolean(specificPassword);
  if (userFromSpecific !== passwordFromSpecific) {
    const needed = userFromSpecific ? `KAFKA_${upper}_SASL_PASSWORD` : `KAFKA_${upper}_SASL_USER`;
    throw new Error(
      `Mixed Kafka credentials for the ${cluster} cluster: a per-cluster ` +
      `${userFromSpecific ? 'username' : 'password'} would be paired with the shared ` +
      `${userFromSpecific ? 'password' : 'username'}. Set ${needed} as well, or clear both ` +
      'per-cluster values to use the shared identity for this cluster.'
    );
  }

  const username = specificUser ?? sharedUser;
  const password = specificPassword ?? sharedPassword;

  if (mechanism || username || password) {
    if (!mechanism || !username || !password) {
      const missing = [
        !mechanism && (clean(env[`KAFKA_${upper}_SASL_MECHANISM`]) ? `KAFKA_${upper}_SASL_MECHANISM` : 'KAFKA_SASL_MECHANISM'),
        !username && 'a username',
        !password && 'a password'
      ].filter(Boolean);
      throw new Error(`Incomplete Kafka SASL configuration. Missing: ${missing.join(', ')}.`);
    }
    const normalised = mechanism.toLowerCase() as SaslMechanism;
    if (!SASL_MECHANISMS.includes(normalised)) {
      throw new Error(
        `Unsupported KAFKA_SASL_MECHANISM "${mechanism}". ` +
        `Use one of: ${SASL_MECHANISMS.join(', ')} (Confluent Cloud is "plain"; ` +
        'Redpanda Cloud and Aiven are "scram-sha-256").'
      );
    }
    // kafkajs types SASLOptions as a discriminated union keyed on the mechanism
    // literal, which cannot be assembled from a runtime value without a cast.
    // The mechanism is validated against the supported list above first.
    options.sasl = { mechanism: normalised, username, password } as SASLOptions;
  }

  return options;
}

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
