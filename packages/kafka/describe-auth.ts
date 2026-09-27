import { getKafkaClientOptions } from './config.js';
import type { KafkaClusterName } from '@roadwatch/core';

/**
 * One-line, secret-free summary of how each cluster will connect.
 *
 * Hosted Kafka refuses plaintext, so a misconfigured deployment otherwise
 * fails at the broker with a SASL handshake error that does not name the
 * variable at fault. This reports the resolved mode instead, so the startup log
 * answers "is TLS on, and which identity am I using" without printing a
 * credential.
 *
 * Never includes the username, password or CA body.
 */
export function describeKafkaAuth(
  cluster: KafkaClusterName,
  env: NodeJS.ProcessEnv = process.env
): string {
  try {
    const options = getKafkaClientOptions(cluster, 'describe', env);
    const tls = options.ssl === true ? 'tls' : options.ssl ? 'tls+ca' : 'plaintext';
    const auth = options.sasl ? `${options.sasl.mechanism}` : 'none';
    return `${cluster}[${tls},sasl=${auth},brokers=${options.brokers.length}]`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${cluster}[UNCONFIGURED: ${message}]`;
  }
}

/** Both clusters on one line, for the startup banner. */
export function describeAllKafkaAuth(env: NodeJS.ProcessEnv = process.env): string {
  return [describeKafkaAuth('events', env), describeKafkaAuth('hlf', env)].join(' ');
}
