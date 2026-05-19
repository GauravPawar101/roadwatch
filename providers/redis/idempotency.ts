import { getRedisClient } from './client.js';
import { isUpstashRedisConfigured } from './config.js';

export type ClaimIdempotencyResult =
  | { ok: true; claimed: true }
  | { ok: true; claimed: false }
  | { ok: false; claimed: true; error: unknown };

/**
 * Attempts to claim an idempotency key.
 * - Returns {claimed:false} if it already exists.
 * - Redis is required; configuration or connectivity failures are treated as fatal.
 */
export async function claimIdempotencyKey(
  key: string,
  ttlSeconds: number
): Promise<ClaimIdempotencyResult> {
  if (!isUpstashRedisConfigured()) {
    throw new Error('Redis is required but UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN is missing');
  }

  const redis = getRedisClient();
  const result = await redis.set(key, '1', { nx: true, ex: ttlSeconds });
  return { ok: true, claimed: result === 'OK' };
}
