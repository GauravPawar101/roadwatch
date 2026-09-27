import { acquirePermitPair, type AdaptiveLimitBounds } from '@roadwatch/redis';

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Write admission for a complaint.
 *
 * A write takes two permits — one for this route and principal, one global — and
 * both are evaluated in a single Redis command, released in a single command.
 * See packages/redis/admission.ts for why a script rather than fewer
 * round-trips.
 *
 * The limits are resolved per cluster of bounds and memoized briefly, so the
 * adaptive pressure read is not paid on every write.
 */
export async function acquireComplaintWriteAdmission(input: {
  routeScope: string;
  principal: string;
}): Promise<{ release: () => Promise<void> }> {
  const { permit } = await acquirePermitPair({
    route: { scope: input.routeScope, principal: input.principal },
    global: { scope: 'gateway:writes:global', principal: 'global' },
    bounds: boundsFromEnv()
  });
  return permit;
}

function boundsFromEnv(): AdaptiveLimitBounds {
  const maxRequests = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_PER_MINUTE, 120);
  const maxInflight = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_INFLIGHT, 24);
  return {
    minRequestsPerWindow: readPositiveInt(
      process.env.COMPLAINT_WRITE_MIN_PER_MINUTE,
      Math.max(20, Math.floor(maxRequests / 4))
    ),
    maxRequestsPerWindow: maxRequests,
    minInflight: readPositiveInt(
      process.env.COMPLAINT_WRITE_MIN_INFLIGHT,
      Math.max(4, Math.floor(maxInflight / 4))
    ),
    maxInflight,
    windowSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_WINDOW_SECONDS, 60),
    inflightTtlSeconds: readPositiveInt(process.env.COMPLAINT_WRITE_INFLIGHT_TTL_SECONDS, 120),
    // Resolving the limits costs several Redis round-trips, so they are
    // memoized briefly instead of on every write. Set to 0 to always re-read.
    limitsCacheMs: Number.parseInt(process.env.COMPLAINT_WRITE_LIMITS_CACHE_MS ?? '2000', 10) || 0
  };
}
