import { getRedisClient } from './client.js';
import { isRedisConfigured } from './config.js';
import {
  acquireDistributedBackpressurePermit,
  type DistributedBackpressureConfig,
  type DistributedBackpressurePermit
} from './backpressure.js';

export type AdaptiveLimitBounds = {
  minRequestsPerWindow: number;
  maxRequestsPerWindow: number;
  minInflight: number;
  maxInflight: number;
  windowSeconds: number;
  inflightTtlSeconds: number;
};

export type AdaptiveLoadSignals = {
  outboxDepth: number;
  recent429Count: number;
  recent5xxCount: number;
};

const EFFECTIVE_KEY = 'roadwatch:backpressure:adaptive:effective';
const SIGNAL_429_KEY = 'roadwatch:backpressure:adaptive:429';
const SIGNAL_5XX_KEY = 'roadwatch:backpressure:adaptive:5xx';
const OUTBOX_GAUGE_KEY = 'roadwatch:metrics:outbox_unpublished';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function recordAdmissionRejection(): Promise<void> {
  if (!isRedisConfigured()) return;
  const redis = getRedisClient();
  const count = await redis.incr(SIGNAL_429_KEY);
  if (count === 1) await redis.expire(SIGNAL_429_KEY, 60);
}

export async function recordUpstreamFailure(): Promise<void> {
  if (!isRedisConfigured()) return;
  const redis = getRedisClient();
  const count = await redis.incr(SIGNAL_5XX_KEY);
  if (count === 1) await redis.expire(SIGNAL_5XX_KEY, 60);
}

export async function setOutboxDepthGauge(depth: number): Promise<void> {
  if (!isRedisConfigured()) return;
  const redis = getRedisClient();
  await redis.set(OUTBOX_GAUGE_KEY, String(Math.max(0, Math.floor(depth))), 'EX', 120);
}

export async function readLoadSignals(): Promise<AdaptiveLoadSignals> {
  if (!isRedisConfigured()) {
    return { outboxDepth: 0, recent429Count: 0, recent5xxCount: 0 };
  }
  const redis = getRedisClient();
  const [outbox, r429, r5xx] = await Promise.all([
    redis.get(OUTBOX_GAUGE_KEY),
    redis.get(SIGNAL_429_KEY),
    redis.get(SIGNAL_5XX_KEY)
  ]);
  return {
    outboxDepth: Number.parseInt(String(outbox ?? '0'), 10) || 0,
    recent429Count: Number.parseInt(String(r429 ?? '0'), 10) || 0,
    recent5xxCount: Number.parseInt(String(r5xx ?? '0'), 10) || 0
  };
}

/**
 * Compute effective admission limits from load signals, shared across gateway replicas via Redis.
 */
export async function resolveAdaptiveLimits(bounds: AdaptiveLimitBounds): Promise<{
  maxRequestsPerWindow: number;
  maxInflight: number;
  windowSeconds: number;
  inflightTtlSeconds: number;
}> {
  const midRequests = Math.round((bounds.minRequestsPerWindow + bounds.maxRequestsPerWindow) / 2);
  const midInflight = Math.round((bounds.minInflight + bounds.maxInflight) / 2);

  if (!isRedisConfigured()) {
    return {
      maxRequestsPerWindow: midRequests,
      maxInflight: midInflight,
      windowSeconds: bounds.windowSeconds,
      inflightTtlSeconds: bounds.inflightTtlSeconds
    };
  }

  const redis = getRedisClient();
  const signals = await readLoadSignals();

  // Pressure score: outbox backlog + rejection/error spikes shrink capacity.
  let pressure = 0;
  if (signals.outboxDepth > 500) pressure += 2;
  else if (signals.outboxDepth > 100) pressure += 1;
  if (signals.recent429Count > 50) pressure += 2;
  else if (signals.recent429Count > 10) pressure += 1;
  if (signals.recent5xxCount > 20) pressure += 2;
  else if (signals.recent5xxCount > 5) pressure += 1;

  const requestSpan = bounds.maxRequestsPerWindow - bounds.minRequestsPerWindow;
  const inflightSpan = bounds.maxInflight - bounds.minInflight;
  const shrink = Math.min(1, pressure / 4);

  const maxRequestsPerWindow = Math.round(
    clamp(bounds.maxRequestsPerWindow - requestSpan * shrink, bounds.minRequestsPerWindow, bounds.maxRequestsPerWindow)
  );
  const maxInflight = Math.round(
    clamp(bounds.maxInflight - inflightSpan * shrink, bounds.minInflight, bounds.maxInflight)
  );

  await redis.set(
    EFFECTIVE_KEY,
    JSON.stringify({
      maxRequestsPerWindow,
      maxInflight,
      windowSeconds: bounds.windowSeconds,
      inflightTtlSeconds: bounds.inflightTtlSeconds,
      pressure,
      updatedAt: new Date().toISOString()
    }),
    'EX',
    120
  );

  return {
    maxRequestsPerWindow,
    maxInflight,
    windowSeconds: bounds.windowSeconds,
    inflightTtlSeconds: bounds.inflightTtlSeconds
  };
}

export async function acquireAdaptiveBackpressurePermit(input: {
  scope: string;
  principal: string;
  bounds: AdaptiveLimitBounds;
}): Promise<DistributedBackpressurePermit> {
  const limits = await resolveAdaptiveLimits(input.bounds);
  const config: DistributedBackpressureConfig = {
    scope: input.scope,
    principal: input.principal,
    maxRequestsPerWindow: limits.maxRequestsPerWindow,
    windowSeconds: limits.windowSeconds,
    maxInflight: limits.maxInflight,
    inflightTtlSeconds: limits.inflightTtlSeconds
  };

  try {
    return await acquireDistributedBackpressurePermit(config);
  } catch (error) {
    await recordAdmissionRejection();
    throw error;
  }
}
