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

/**
 * Warns when the inflight cap is above the connection pool.
 *
 * Every admitted complaint write holds a Postgres connection for the length of
 * its transaction, so the pool is the real ceiling on concurrency and the inflight
 * cap is only a policy above it. A cap above the pool does not raise throughput;
 * it converts what should be a cheap 429 into a multi-second wait on connection
 * acquire. Measured at inflight 200 against a pool of 20: 93 of 690 requests
 * answered 500 with `timeout exceeded when trying to connect`.
 *
 * Warned rather than rejected, because the two are independently tuned and a
 * deliberate over-provisioned pool is legitimate. But the mismatch is the most
 * common cause of write-path 500s, and it is invisible until it is measured.
 */
function warnOnPoolMismatch(maxInflight: number): void {
  const poolMax = readPositiveInt(process.env.PGPOOL_MAX, 20);
  if (maxInflight > poolMax) {
    console.warn(
      `[gateway-api] COMPLAINT_WRITE_MAX_INFLIGHT=${maxInflight} exceeds PGPOOL_MAX=${poolMax}. ` +
        `Each admitted write holds a connection for its transaction, so the pool is the real ceiling: ` +
        `writes beyond ${poolMax} will wait on connection acquire instead of being shed with a 429.`
    );
  }
}

function boundsFromEnv(): AdaptiveLimitBounds {
  const maxRequests = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_PER_MINUTE, 120);
  const maxInflight = readPositiveInt(process.env.COMPLAINT_WRITE_MAX_INFLIGHT, 24);
  warnOnPoolMismatch(maxInflight);
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
