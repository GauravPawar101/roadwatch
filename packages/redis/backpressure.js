import { getRedisClient } from './client.js';
import { isRedisConfigured } from './config.js';
function normalizedScope(scope) {
    return scope.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
}
function currentWindow(windowSeconds) {
    return String(Math.floor(Date.now() / 1000 / windowSeconds));
}
export async function acquireDistributedBackpressurePermit(config) {
    if (!isRedisConfigured()) {
        throw new Error('Redis is required but not configured. Set REDIS_URL or REDIS_HOST/REDIS_PORT');
    }
    const redis = getRedisClient();
    const scope = normalizedScope(config.scope);
    const principal = config.principal.trim().toLowerCase() || 'anonymous';
    const rateKey = `roadwatch:backpressure:${scope}:rate:${principal}:${currentWindow(config.windowSeconds)}`;
    const inflightKey = `roadwatch:backpressure:${scope}:inflight:${principal}`;
    const rateCount = await redis.incr(rateKey);
    if (rateCount === 1) {
        await redis.expire(rateKey, config.windowSeconds);
    }
    if (rateCount > config.maxRequestsPerWindow) {
        await redis.decr(rateKey);
        const error = new Error('Rate limit exceeded');
        error.statusCode = 429;
        error.retryAfterSeconds = config.windowSeconds;
        throw error;
    }
    const inflightCount = await redis.incr(inflightKey);
    if (inflightCount === 1) {
        await redis.expire(inflightKey, config.inflightTtlSeconds);
    }
    if (inflightCount > config.maxInflight) {
        await redis.decr(inflightKey);
        await redis.decr(rateKey);
        const error = new Error('Write backlog too deep');
        error.statusCode = 429;
        error.retryAfterSeconds = Math.max(1, Math.min(config.windowSeconds, config.inflightTtlSeconds));
        throw error;
    }
    return {
        release: async () => {
            try {
                await redis.decr(inflightKey);
            }
            catch {
                // Best effort: the TTL on the inflight key keeps stale permits from lingering forever.
            }
        }
    };
}
