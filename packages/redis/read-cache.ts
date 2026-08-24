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

async function currentGeneration(redis: { get: (key: string) => Promise<string | null> }): Promise<string> {
  return (await redis.get(GEN_KEY)) ?? '0';
}

export async function readCachedJson<T>(route: string, parts: Record<string, unknown>): Promise<T | null> {
  if (!isReadCacheEnabled() || !isRedisConfigured()) {
    missCount += 1;
    return null;
  }

  try {
    const redis = getRedisClient();
    const gen = await currentGeneration(redis);
    const key = `${KEY_PREFIX}:${gen}:${route}:${hashParts(parts)}`;
    const raw = await redis.get(key);
    if (!raw) {
      missCount += 1;
      return null;
    }
    hitCount += 1;
    return JSON.parse(raw) as T;
  } catch {
    missCount += 1;
    return null;
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
