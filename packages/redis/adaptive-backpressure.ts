import { getRedisClient } from './client.js';
import { isRedisConfigured } from './config.js';
import {
  acquireAdmission,
  admissionRejection,
  type AdmissionOutcome,
  type DistributedBackpressureConfig,
  type DistributedBackpressurePermit
} from './admission.js';

export type AdaptiveLimitBounds = {
  minRequestsPerWindow: number;
  maxRequestsPerWindow: number;
  minInflight: number;
  maxInflight: number;
  windowSeconds: number;
  inflightTtlSeconds: number;
  /**
   * How long a resolved limit may be reused in-process before the load signals
   * are read again. Defaults to 2000ms.
   *
   * The limits move on the scale of seconds (outbox depth, error counters),
   * so re-reading them on every request spends several Redis round-trips per
   * request to obtain a value that has barely changed. Under load that
   * overhead was measured at ~37 Redis commands per complaint write, the
   * majority of them admission-control bookkeeping rather than application
   * work. Set to 0 to always re-read.
   */
  limitsCacheMs?: number;
};

const DEFAULT_LIMITS_CACHE_MS = 2000;

type ResolvedLimits = {
  maxRequestsPerWindow: number;
  maxInflight: number;
  windowSeconds: number;
  inflightTtlSeconds: number;
};

/** Cached per distinct bounds so two services with different limits do not collide. */
const limitsCache = new Map<string, { at: number; limits: ResolvedLimits }>();

/** Test hook: drops memoized limits so a test starts from a known state. */
export function resetAdaptiveLimitsCache(): void {
  limitsCache.clear();
}

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
export async function resolveAdaptiveLimits(bounds: AdaptiveLimitBounds): Promise<ResolvedLimits> {
  const cacheMs = bounds.limitsCacheMs ?? DEFAULT_LIMITS_CACHE_MS;
  const cacheKey = JSON.stringify([
    bounds.minRequestsPerWindow,
    bounds.maxRequestsPerWindow,
    bounds.minInflight,
    bounds.maxInflight,
    bounds.windowSeconds,
    bounds.inflightTtlSeconds,
    cacheMs
  ]);

  const now = Date.now();
  const memo = limitsCache.get(cacheKey);
  if (memo && now - memo.at < cacheMs) {
    return memo.limits;
  }

  const limits = await computeAdaptiveLimits(bounds);
  limitsCache.set(cacheKey, { at: now, limits });
  return limits;
}

async function computeAdaptiveLimits(bounds: AdaptiveLimitBounds): Promise<ResolvedLimits> {
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

  // Pressure score: genuine load signals shrink capacity.
  //
  // recent429Count is deliberately NOT an input. A rejection is an *output* of
  // this limiter, so feeding it back into the score that decides the ceiling
  // closes a control loop around its own output: rejections raise pressure,
  // pressure lowers the ceiling, the lower ceiling causes more rejections.
  // Under sustained load that ratchets to the floor and never recovers, which
  // makes the configured maximum structurally unreachable.
  //
  // Measured before this change: a 1000-VU run stayed pinned at pressure 4
  // (the maximum) for the entire run, collapsing the effective window to
  // minRequestsPerWindow and the inflight cap to minInflight — 15,000/min and
  // 100 concurrent against a configured 60,000/min and 400.
  //
  // The remaining inputs are independent of the limiter's own decisions:
  // outbox depth is a real downstream backlog and 5xx count is a real upstream
  // failure. Both are transient, so capacity recovers once the backlog drains.
  // The 429 count is still tracked and exported for observability.
  let pressure = 0;
  if (signals.outboxDepth > 500) pressure += 2;
  else if (signals.outboxDepth > 100) pressure += 1;
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
  const admission = await acquireAdmission(getRedisClient(), [permitConfig(input, await resolveAdaptiveLimits(input.bounds))]);
  if (!admission.outcome.admitted) {
    await recordAdmissionRejection();
    throw admissionRejection(admission.outcome, admission.outcome.rejection ?? 'inflight');
  }
  return { release: admission.release };
}

/**
 * The admission a complaint write actually takes: a route/principal permit and
 * a global one, acquired together.
 *
 * Both are evaluated in a single Redis command and released in a single command.
 * The previous implementation issued them as two independent four-command
 * sequences — six commands per write, measured — and, because the increments were
 * not atomic, could admit more concurrent writes than `maxInflight` allowed.
 * Acquired as a pair, a write that is refused is also not charged for a
 * half-taken permit.
 */
export async function acquirePermitPair(input: {
  route: { scope: string; principal: string };
  global: { scope: string; principal: string };
  bounds: AdaptiveLimitBounds;
}): Promise<{ permit: DistributedBackpressurePermit; outcome: AdmissionOutcome }> {
  if (!isRedisConfigured()) {
    throw new Error(
      'Redis is required for write admission but not configured. ' +
        'Set REDIS_CLOUD_URL/REDIS_MANAGED_URL for a managed instance, or REDIS_URL for an explicit one.',
    );
  }

  const limits = await resolveAdaptiveLimits(input.bounds);
  const admission = await acquireAdmission(
    getRedisClient(),
    [permitConfig(input.route, limits), permitConfig(input.global, limits)],
    ['route', 'global']
  );

  if (!admission.outcome.admitted) {
    await recordAdmissionRejection();
    throw admissionRejection(admission.outcome, admission.outcome.rejection ?? 'inflight');
  }

  return { permit: { release: admission.release }, outcome: admission.outcome };
}

/** Applies one resolved limit set to one permit target. */
function permitConfig(
  target: { scope: string; principal: string },
  limits: ResolvedLimits
): DistributedBackpressureConfig {
  return {
    scope: target.scope,
    principal: target.principal,
    maxRequestsPerWindow: limits.maxRequestsPerWindow,
    windowSeconds: limits.windowSeconds,
    maxInflight: limits.maxInflight,
    inflightTtlSeconds: limits.inflightTtlSeconds
  };
}
