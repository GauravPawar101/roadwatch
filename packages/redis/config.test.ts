import { describe, expect, it } from 'vitest';
import { getRedisConfig, isRedisConfigured } from './config';

const IN_CLUSTER = 'redis://redis.roadwatch.svc.cluster.local:6379/0';
const MANAGED = 'rediss://default:secret@apn1-cool-redis.upstash.io:6379';

describe('redis endpoint resolution', () => {
  it('prefers the managed URL over the in-cluster one', () => {
    const env = { REDIS_URL: IN_CLUSTER, REDIS_CLOUD_URL: MANAGED } as NodeJS.ProcessEnv;
    const config = getRedisConfig(env);

    expect(config.url).toBe(MANAGED);
    expect(config.source).toBe('cloud');
    expect(config.tls).toBe(true);
  });

  it('accepts REDIS_MANAGED_URL as an alias', () => {
    const env = { REDIS_URL: IN_CLUSTER, REDIS_MANAGED_URL: MANAGED } as NodeJS.ProcessEnv;
    expect(getRedisConfig(env).url).toBe(MANAGED);
  });

  it('falls back to REDIS_URL when no managed value is set', () => {
    const env = { REDIS_URL: IN_CLUSTER } as NodeJS.ProcessEnv;
    const config = getRedisConfig(env);

    expect(config.url).toBe(IN_CLUSTER);
    expect(config.source).toBe('explicit');
  });

  it('builds a URL from discrete parts when no URL form is set', () => {
    const env = {
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'p@ss word',
    } as NodeJS.ProcessEnv;
    const config = getRedisConfig(env);

    expect(config.url).toBe('redis://:p%40ss%20word@redis.internal:6380/0');
  });

  /**
   * The previous implementation cached in a module-level variable and ignored
   * its `env` argument, so the second call with a different environment
   * silently returned the first call's URL.
   */
  it('does not leak the first env result into a second call', () => {
    const first = { REDIS_CLOUD_URL: MANAGED } as NodeJS.ProcessEnv;
    const second = { REDIS_URL: IN_CLUSTER } as NodeJS.ProcessEnv;

    expect(getRedisConfig(first).url).toBe(MANAGED);
    expect(getRedisConfig(second).url).toBe(IN_CLUSTER);
  });

  it('reports configured when only a managed URL is present', () => {
    expect(isRedisConfigured({ REDIS_CLOUD_URL: MANAGED } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('throws an actionable error when nothing is configured', () => {
    expect(() => getRedisConfig({} as NodeJS.ProcessEnv)).toThrow(/REDIS_CLOUD_URL/);
  });
});
