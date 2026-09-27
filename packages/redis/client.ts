import Redis from 'ioredis';
import { getRedisConfig } from './config.js';

let cached: any = null;

// Returns a local Redis client for Docker/dev environments.
export function getRedisClient(): any {
  if (cached) return cached;

  const { url } = getRedisConfig();
  const RedisClient = Redis as unknown as new (redisUrl: string) => any;
  cached = new RedisClient(url);
  return cached;
}

/**
 * Closes the cached client, if one was ever created.
 *
 * Without this the ioredis socket keeps the event loop alive, so a graceful
 * shutdown finishes draining and then hangs instead of exiting, and the platform
 * SIGKILLs the process — losing the benefit of the drain entirely.
 *
 * Safe to call when no client exists, and idempotent, so a shutdown path does not
 * have to track whether it connected.
 */
export async function closeRedisClient(): Promise<void> {
  if (!cached) return;
  const client = cached;
  // Cleared first: a second call must not await the same quit twice.
  cached = null;
  try {
    await client.quit();
  } catch {
    // A client that is already gone, or a network that dropped, must not stop the
    // rest of the shutdown. destroy() is the backstop for a quit that hangs.
    try {
      client.disconnect?.();
    } catch {
      // Nothing further to do; the process is exiting.
    }
  }
}
