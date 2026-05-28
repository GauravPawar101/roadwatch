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
