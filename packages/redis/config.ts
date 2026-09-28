import { resolveRedisEndpoint } from '@roadwatch/core';

// The Upstash REST -> TCP derivation lives in the shared resolver so that
// everything asking "which endpoint will we dial?" gets the same answer. It is
// re-exported here because the Redis package is where callers expect to find
// it.
export { deriveUpstashTcpUrl } from '@roadwatch/core';

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
 *
 * Memoized per environment object, for the same reason `getRedisConfig` is: the
 * answer depends only on the environment, and recomputing it is pure overhead.
 *
 * It was not memoized, and it is called on the request path — the complaint
 * read-cache invalidation checks it on every write. Profiling the write path put
 * `resolveChain` in the request at 0.9% of process CPU, reached only through this
 * function, to answer a question whose answer cannot change while the process is
 * running.
 *
 * Keyed on the environment object rather than a single boolean, so a test or a
 * probe passing a different environment still gets the right answer.
 */
const configuredCache = new WeakMap<object, boolean>();

export function isRedisConfigured(env: RedisEnv = process.env): boolean {
  const cached = configuredCache.get(env);
  if (cached !== undefined) return cached;

  const { url } = resolveRedisEndpoint(env);
  const configured = url.length > 0;
  configuredCache.set(env, configured);
  return configured;
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
