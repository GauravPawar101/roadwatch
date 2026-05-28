import { getRedisClient } from './client.js';
import { isRedisConfigured } from './config.js';

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
  if (!isRedisConfigured()) {
    throw new Error('Redis is required but not configured. Set REDIS_URL or REDIS_HOST/REDIS_PORT');
  }

  const redis = getRedisClient();
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return { ok: true, claimed: result === 'OK' };
}
