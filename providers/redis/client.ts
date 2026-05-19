import { Redis } from '@upstash/redis';
import { getUpstashRedisConfig } from './config.js';

let cached: Redis | null = null;

export function getRedisClient(): Redis {
  if (cached) return cached;
  const { url, token } = getUpstashRedisConfig();
  cached = new Redis({ url, token });
  return cached;
}
