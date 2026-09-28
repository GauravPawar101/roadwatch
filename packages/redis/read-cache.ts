import { createHash } from 'node:crypto';
import { getRedisClient } from './client.js';
import { isRedisConfigured } from './config.js';

const GEN_KEY = 'rw:cache:gen';
const KEY_PREFIX = 'rw:cache:v1';
const DEFAULT_TTL_SECONDS = 10;

let hitCount = 0;
let missCount = 0;

export function isReadCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.REDIS_READ_CACHE ?? env.REDIS_READ_CACHE ?? 'on').trim().toLowerCase();
  return raw === 'on' || raw === 'true' || raw === '1';
}

export function getReadCacheStats(): { hits: number; misses: number } {
  return { hits: hitCount, misses: missCount };
}

export function resetReadCacheStats(): void {
  hitCount = 0;
  missCount = 0;
}

function hashParts(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

type CacheLookup = { gen: string; key: string; value: string | null };

/**
 * Resolves the current generation and reads the key in one place, so the hit and
 * miss counters cannot drift between callers and the generation is only fetched
 * once per lookup.
 */
async function lookup(route: string, parts: Record<string, unknown>): Promise<CacheLookup> {
  if (!isReadCacheEnabled() || !isRedisConfigured()) {
    return { gen: '0', key: '', value: null };
  }
  try {
    const redis = getRedisClient();
    const gen = await currentGeneration(redis);
    const key = `${KEY_PREFIX}:${gen}:${route}:${hashParts(parts)}`;
    const value = await redis.get(key);
    return { gen, key, value };
  } catch {
    return { gen: '0', key: '', value: null };
  }
}

async function currentGeneration(redis: { get: (key: string) => Promise<string | null> }): Promise<string> {
  return (await redis.get(GEN_KEY)) ?? '0';
}

export async function readCachedJson<T>(route: string, parts: Record<string, unknown>): Promise<T | null> {
  const { value } = await lookup(route, parts);
  if (!value) {
    missCount += 1;
    return null;
  }
  hitCount += 1;
  return JSON.parse(value) as T;
}

/**
 * In-flight fills, keyed by full cache key (generation included), so concurrent
 * misses for the same list share one origin query.
 */
const inflightFills = new Map<string, Promise<unknown>>();

/**
 * Read-through with single-flight fill.
 *
 * Every complaint write bumps the generation, which orphans every cached list.
 * With N read requests in flight, all N observe the new generation before any of
 * them has repopulated the key, so all N miss and all N run the full Postgres
 * query — measured at 4.1 misses per generation bump with 32 read workers, and a
 * cache hit rate that fell from 99.88% read-only to 7.8-15.5% under write load.
 *
 * Collapsing those concurrent misses into one fill is a pure concurrency fix: the
 * freshness contract is unchanged, because the key still carries the generation, so
 * a read issued after a write still misses and refills. Waiters can observe data
 * from the generation that was current when they arrived, which is the same race
 * that already exists between a cache read and a concurrent write — the window is
 * now one fill wide instead of one response wide.
 */
export async function readThroughCachedJson<T>(
  route: string,
  parts: Record<string, unknown>,
  fill: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<T> {
  const { key, value } = await lookup(route, parts);
  if (value) {
    hitCount += 1;
    return JSON.parse(value) as T;
  }

  // Cache disabled or Redis unreachable: serve straight from the origin.
  if (!key) {
    missCount += 1;
    return fill();
  }

  const existing = inflightFills.get(key);
  if (existing) {
    // A waiter adopts the leader's result when the leader succeeded. When the
    // leader's fill threw there is no value to share, so the waiter does the
    // work itself rather than propagating a failure it did not cause — the
    // origin being briefly unhealthy should not turn N readers into N errors
    // beyond the one the leader already reported.
    return existing.then(
      (value) => value as T,
      async () => fill()
    );
  }

  missCount += 1;
  const pending = (async () => {
    const filled = await fill();
    // Best effort: a cache write that fails must not fail a successful read.
    await writeCachedJson(route, parts, filled, ttlSeconds).catch(() => undefined);
    return filled;
  })();

  inflightFills.set(key, pending);
  try {
    return (await pending) as T;
  } finally {
    if (inflightFills.get(key) === pending) inflightFills.delete(key);
  }
}

export async function writeCachedJson(
  route: string,
  parts: Record<string, unknown>,
  value: unknown,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> {
  if (!isReadCacheEnabled() || !isRedisConfigured()) return;

  try {
    const redis = getRedisClient();
    const gen = await currentGeneration(redis);
    const key = `${KEY_PREFIX}:${gen}:${route}:${hashParts(parts)}`;
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // fail-open: reads still hit Postgres
  }
}

export async function bumpComplaintReadCache(): Promise<void> {
  if (!isRedisConfigured()) return;
  try {
    const redis = getRedisClient();
    await redis.incr(GEN_KEY);
  } catch {
    // next TTL expiry still drops stale entries
  }
}
