import Redis from 'ioredis';
import { getRedisConfig } from './config.js';
let cached = null;
// Returns a local Redis client for Docker/dev environments.
export function getRedisClient() {
    if (cached)
        return cached;
    const { url } = getRedisConfig();
    const RedisClient = Redis;
    cached = new RedisClient(url);
    return cached;
}
