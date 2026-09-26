import { resolveRedisEndpoint } from '@roadwatch/core';

export type RedisConfig = {
  url: string;
  /** Which tier of the fallback chain supplied the URL. */
  source: string;
  /** True when the endpoint is TLS (rediss://), typical of managed offerings. */
  tls: boolean;
  db: number;
};

type RedisEnv = NodeJS.ProcessEnv;

/**
 * True when Redis can be reached under the documented precedence chain,
 * including a managed/cloud URL. Callers use this to decide whether to start
 * optional features, so it must not report "unconfigured" merely because the
 * in-cluster REDIS_URL is absent while a managed URL is present.
 */
export function isRedisConfigured(env: RedisEnv = process.env): boolean {
  const { url } = resolveRedisEndpoint(env);
  return url.length > 0;
}

/**
 * Resolve the Redis endpoint.
 *
 * Delegates to the shared resolver in @roadwatch/core so the precedence order
 * lives in exactly one place. This file previously carried its own copy of the
 * chain, which was correct at the time but free to drift away from the
 * resolver the other services use.
 *
 * The result is cached per environment object rather than globally: the
 * previous module-level cache ignored the `env` argument, so a second call
 * with a different environment returned the first call's URL.
 */
const cache = new WeakMap<object, RedisConfig>();

export function getRedisConfig(env: RedisEnv = process.env): RedisConfig {
  const cached = cache.get(env);
  if (cached) return cached;

  const resolved = resolveRedisEndpoint(env);
  if (!resolved.url) {
    throw new Error(
      'Redis is not configured. Set REDIS_CLOUD_URL / REDIS_MANAGED_URL for a managed instance, ' +
        'REDIS_URL for an explicit endpoint, or REDIS_HOST (+ REDIS_PORT) for a local one.',
    );
  }

  const config: RedisConfig = {
    url: resolved.url,
    source: resolved.source,
    tls: resolved.tls,
    db: resolved.db,
  };
  cache.set(env, config);
  return config;
}
