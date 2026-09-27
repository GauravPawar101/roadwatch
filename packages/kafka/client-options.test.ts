import { describe, expect, it } from 'vitest';
import { getKafkaClientOptions } from './config.js';

const BROKERS = ['pkc-abc.europe-west1.gcp.confluent.cloud:9094'];

/**
 * Hosted Kafka refuses plaintext connections, so the client previously had no
 * way to authenticate at all: `new Kafka({ clientId, brokers })` only. These
 * pin the credential resolution, including the failure modes that would
 * otherwise surface as an opaque SASL handshake error.
 */

describe('getKafkaClientOptions TLS', () => {
  it('leaves ssl off when nothing is configured, for the local plaintext stack', () => {
    const options = getKafkaClientOptions('events', 'test', {
      KAFKA_EVENTS_BROKERS: '127.0.0.1:9095',
    } as NodeJS.ProcessEnv);

    expect(options.ssl).toBeUndefined();
    expect(options.sasl).toBeUndefined();
  });

  it('enables TLS from the shared switch', () => {
    const options = getKafkaClientOptions('events', 'test', {
      KAFKA_EVENTS_BROKERS: BROKERS[0]!,
      KAFKA_SSL: 'true',
    } as NodeJS.ProcessEnv);

    expect(options.ssl).toBe(true);
  });

  it('uses a provider CA bundle when one is supplied', () => {
    const options = getKafkaClientOptions('events', 'test', {
      KAFKA_EVENTS_BROKERS: BROKERS[0]!,
      KAFKA_SSL_CA: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    } as NodeJS.ProcessEnv);

    expect(options.ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' });
  });

  it('lets a per-cluster switch override the shared one', () => {
    const options = getKafkaClientOptions('hlf', 'test', {
      KAFKA_HLF_BROKERS: BROKERS[0]!,
      KAFKA_SSL: 'true',
      KAFKA_HLF_SSL: 'false',
    } as NodeJS.ProcessEnv);

    expect(options.ssl).toBeUndefined();
  });
});

describe('getKafkaClientOptions SASL', () => {
  it('applies shared credentials to whichever cluster asks', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: BROKERS[0]!,
      KAFKA_HLF_BROKERS: BROKERS[0]!,
      KAFKA_SSL: 'true',
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USER: 'key',
      KAFKA_SASL_PASSWORD: 'secret',
    } as NodeJS.ProcessEnv;

    expect(getKafkaClientOptions('events', 'test', env).sasl).toEqual({
      mechanism: 'plain',
      username: 'key',
      password: 'secret',
    });
    expect(getKafkaClientOptions('hlf', 'test', env).sasl).toEqual({
      mechanism: 'plain',
      username: 'key',
      password: 'secret',
    });
  });

  /** The deployment shape being used: two providers, two clusters, two keys. */
  it('gives each cluster its own credentials when they differ', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: 'a.confluent.cloud:9094',
      KAFKA_HLF_BROKERS: 'b.redpanda.com:9094',
      KAFKA_SSL: 'true',
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USER: 'shared',
      KAFKA_SASL_PASSWORD: 'shared',
      KAFKA_EVENTS_SASL_USER: 'confluent-key',
      KAFKA_EVENTS_SASL_PASSWORD: 'confluent-secret',
      KAFKA_HLF_SASL_MECHANISM: 'scram-sha-256',
      KAFKA_HLF_SASL_USER: 'redpanda-key',
      KAFKA_HLF_SASL_PASSWORD: 'redpanda-secret',
    } as NodeJS.ProcessEnv;

    const events = getKafkaClientOptions('events', 'test', env);
    const hlf = getKafkaClientOptions('hlf', 'test', env);

    expect(events.sasl).toEqual({ mechanism: 'plain', username: 'confluent-key', password: 'confluent-secret' });
    expect(hlf.sasl).toEqual({ mechanism: 'scram-sha-256', username: 'redpanda-key', password: 'redpanda-secret' });
    expect(events.brokers).toEqual(['a.confluent.cloud:9094']);
    expect(hlf.brokers).toEqual(['b.redpanda.com:9094']);
  });

  /**
   * The dangerous case: one cluster's username with the shared password. That
   * authenticates as the wrong identity and fails at the broker with a message
   * that does not point at the configuration error.
   */
  it('refuses to mix a per-cluster username with the shared password', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: BROKERS[0]!,
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USER: 'shared',
      KAFKA_SASL_PASSWORD: 'shared',
      KAFKA_EVENTS_SASL_USER: 'confluent-key',
    } as NodeJS.ProcessEnv;

    expect(() => getKafkaClientOptions('events', 'test', env)).toThrow(/Mixed Kafka credentials/);
    expect(() => getKafkaClientOptions('events', 'test', env)).toThrow(/KAFKA_EVENTS_SASL_PASSWORD/);
  });

  it('refuses a partial shared credential set', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: BROKERS[0]!,
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USER: 'key',
    } as NodeJS.ProcessEnv;

    expect(() => getKafkaClientOptions('events', 'test', env)).toThrow(/Incomplete Kafka SASL/);
  });

  it('rejects an unsupported mechanism and names the valid ones', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: BROKERS[0]!,
      KAFKA_SASL_MECHANISM: 'oauthbearer',
      KAFKA_SASL_USER: 'key',
      KAFKA_SASL_PASSWORD: 'secret',
    } as NodeJS.ProcessEnv;

    expect(() => getKafkaClientOptions('events', 'test', env)).toThrow(/Unsupported KAFKA_SASL_MECHANISM/);
    // The message must list what is valid, so the fix is obvious.
    expect(() => getKafkaClientOptions('events', 'test', env)).toThrow(/scram-sha-256/);
  });

  it('accepts an upper-case mechanism from a human-typed .env', () => {
    const env = {
      KAFKA_EVENTS_BROKERS: BROKERS[0]!,
      KAFKA_SASL_MECHANISM: 'PLAIN',
      KAFKA_SASL_USER: 'key',
      KAFKA_SASL_PASSWORD: 'secret',
    } as NodeJS.ProcessEnv;

    expect(getKafkaClientOptions('events', 'test', env).sasl).toMatchObject({ mechanism: 'plain' });
  });

  it('errors clearly when a cluster has no brokers at all', () => {
    const env = { KAFKA_HLF_BROKERS: '' } as NodeJS.ProcessEnv;
    expect(() => getKafkaClientOptions('hlf', 'test', env)).toThrow(/HLF Kafka is required/);
  });
});
