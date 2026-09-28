import { describe, expect, it } from 'vitest';
import { describeAllKafkaAuth, describeKafkaAuth } from './describe-auth.js';

/**
 * The startup banner answers "did the managed endpoints actually take effect"
 * without anyone having to read a handshake error. Two properties matter: it
 * must report the resolved mode accurately, and it must never print a
 * credential.
 */

const HOSTED = {
  KAFKA_EVENTS_CLOUD_BROKERS: 'pkc-abc.europe-west1.gcp.confluent.cloud:9094',
  KAFKA_HLF_CLOUD_BROKERS: 'a-1.redpanda.com:9094,b-1.redpanda.com:9094',
  KAFKA_SSL: 'true',
  KAFKA_SASL_MECHANISM: 'plain',
  KAFKA_SASL_USER: 'SHARED-USER',
  KAFKA_SASL_PASSWORD: 'SHARED-SECRET',
  KAFKA_EVENTS_SASL_USER: 'confluent-key',
  KAFKA_EVENTS_SASL_PASSWORD: 'confluent-secret',
  KAFKA_HLF_SASL_MECHANISM: 'scram-sha-256',
  KAFKA_HLF_SASL_USER: 'redpanda-key',
  KAFKA_HLF_SASL_PASSWORD: 'redpanda-secret',
} as NodeJS.ProcessEnv;

describe('describeKafkaAuth', () => {
  it('reports the plaintext local stack honestly', () => {
    const line = describeKafkaAuth('events', {
      KAFKA_EVENTS_BROKERS: '127.0.0.1:9095',
    } as NodeJS.ProcessEnv);

    expect(line).toBe('events[plaintext,sasl=none,brokers=1]');
  });

  it('reports TLS and the per-cluster mechanism for a split-provider setup', () => {
    expect(describeKafkaAuth('events', HOSTED)).toBe('events[tls,sasl=plain,brokers=1]');
    expect(describeKafkaAuth('hlf', HOSTED)).toBe('hlf[tls,sasl=scram-sha-256,brokers=2]');
  });

  it('never prints a username, password or CA body', () => {
    const banner = describeAllKafkaAuth({
      ...HOSTED,
      KAFKA_SSL_CA: '-----BEGIN CERTIFICATE-----secret-ca-body-----END CERTIFICATE-----',
    });

    for (const secret of [
      'SHARED-USER',
      'SHARED-SECRET',
      'confluent-key',
      'confluent-secret',
      'redpanda-key',
      'redpanda-secret',
      'secret-ca-body',
    ]) {
      expect(banner).not.toContain(secret);
    }
  });

  it('surfaces a configuration error instead of silently reporting a mode', () => {
    // Hosted Kafka refuses plaintext, so a misconfigured deployment must be
    // obvious in the log rather than discovered at the broker.
    const line = describeKafkaAuth('events', {} as NodeJS.ProcessEnv);
    expect(line).toContain('UNCONFIGURED');
    expect(line).toContain('KAFKA_EVENTS_CLOUD_BROKERS');
  });

  it('flags a mixed-credential misconfiguration in the banner', () => {
    const line = describeKafkaAuth('events', {
      KAFKA_EVENTS_BROKERS: 'broker:9094',
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USER: 'shared',
      KAFKA_SASL_PASSWORD: 'shared',
      KAFKA_EVENTS_SASL_USER: 'other',
    } as NodeJS.ProcessEnv);

    expect(line).toContain('UNCONFIGURED');
    expect(line).toContain('Mixed Kafka credentials');
  });
});
