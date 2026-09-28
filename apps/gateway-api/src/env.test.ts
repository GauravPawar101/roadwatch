import { describe, expect, it } from 'vitest';
import { assertRequiredInfrastructure } from './env.js';

const MANAGED_REDIS = 'rediss://default:secret@apn1-cool-redis.upstash.io:6379';
const MANAGED_KAFKA = 'pkc-abc.europe-west1.gcp.confluent.cloud:9092';

/**
 * Regression guard.
 *
 * The assertion used to test only REDIS_URL/REDIS_HOST and
 * KAFKA_BROKERS/KAFKA_BROKER, so a deployment configured solely with managed
 * endpoints was declared unconfigured and the gateway refused to boot — even
 * though both dependencies were fully specified.
 */
describe('assertRequiredInfrastructure', () => {
  it('accepts a managed Redis and managed Kafka with no in-cluster values', () => {
    expect(() =>
      assertRequiredInfrastructure({
        REDIS_CLOUD_URL: MANAGED_REDIS,
        KAFKA_EVENTS_CLOUD_BROKERS: MANAGED_KAFKA,
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('accepts in-cluster Redis and Kafka', () => {
    expect(() =>
      assertRequiredInfrastructure({
        REDIS_URL: 'redis://redis:6379/0',
        KAFKA_BROKERS: 'kafka:9092',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('prefers the managed Kafka over the in-cluster one without complaining', () => {
    expect(() =>
      assertRequiredInfrastructure({
        REDIS_CLOUD_URL: MANAGED_REDIS,
        KAFKA_BROKERS: 'kafka:9092',
        KAFKA_EVENTS_CLOUD_BROKERS: MANAGED_KAFKA,
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('rejects a deployment with neither Redis nor Kafka configured', () => {
    expect(() => assertRequiredInfrastructure({} as NodeJS.ProcessEnv)).toThrow(/Redis/);
  });

  it('names the managed Redis variable when Redis is missing', () => {
    expect(() =>
      assertRequiredInfrastructure({ KAFKA_BROKERS: 'kafka:9092' } as NodeJS.ProcessEnv),
    ).toThrow(/REDIS_CLOUD_URL/);
  });

  it('names the managed Kafka variable when Kafka is missing', () => {
    expect(() =>
      assertRequiredInfrastructure({ REDIS_URL: 'redis://redis:6379/0' } as NodeJS.ProcessEnv),
    ).toThrow(/KAFKA_EVENTS_CLOUD_BROKERS/);
  });
});
