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
function warnOnPoolMismatch(
  maxInflight: number,
  variable = 'COMPLAINT_WRITE_MAX_INFLIGHT',
  poolMax = readPositiveInt(process.env.PGPOOL_MAX, 20),
): void {
  if (maxInflight > poolMax) {
    console.warn(
      `[gateway-api] ${variable}=${maxInflight} exceeds PGPOOL_MAX=${poolMax}. ` +
        `Each admitted request holds a connection for its query, so the pool is the real ceiling: ` +
        `requests beyond ${poolMax} will wait on connection acquire instead of being shed with a 429.`
    );
  }
}

/**
 * Read admission, so read overload sheds load instead of exhausting the pool.
 *
 * The write path has had admission control since it was added; the read path had
 * none, which is precisely how an unbounded read load reached the connection pool
 * in the first place. Observed at ~1,000 read req/s: the pool was exhausted,
 * every request failed with `timeout exceeded when trying to connect`, 100
 * unhandled rejections accumulated in about two seconds and the process exited.
 * A restart is the worst possible response to a traffic spike — it drops the
 * connections that would have recovered on their own.
 *
 * The inflight default is the *connection pool size*, not a separate number.
 * Every read holds a connection for the length of its query, so the pool is the
 * concurrency ceiling; a read cap above it converts cheap rejections into acquire
 * waits. Deriving the default from PGPOOL_MAX keeps the two in step
 * automatically, which is the mismatch that made the write path return 500s.
 *
 * The per-principal cap is the `route` permit; the global cap is the second.
 * Together they mean one client cannot occupy the whole pool and starve everyone
 * else. Both are evaluated in a single Redis command.
 *
 * Reads are not rate-limited by default — the inflight cap is what protects the
 * pool, and an arbitrary requests-per-window would shed well-behaved traffic for
 * no benefit. The window is set generously so the effective limit is concurrency.
 */
export async function acquireReadAdmission(input: {
  routeScope: string;
  principal: string;
}): Promise<{ release: () => Promise<void> }> {
  const poolMax = readPositiveInt(process.env.PGPOOL_MAX, 20);

  // Off by default, and that is a measured decision rather than an omission.
  //
  // This was added to stop read overload exhausting the pool and killing the
  // process. It does that, but it costs more than it saves:
  //
  //  * Every read pays two Redis round-trips, including the large majority served
  //    from the read cache that hold no database connection at all. Measured at
  //    concurrency 64: 1,640 accepted/s with the cap against 2,838 without it —
  //    45% of read throughput spent bounding requests that cost nothing.
  //  * Sizing it at the pool size made it worse still, and measurably wrong: the
  //    assumption that every read holds a connection no longer holds once the
  //    cache is in front of it.
  //  * The failure it was written for no longer occurs. The process died from
  //    unhandled rejections thrown by connection-acquire timeouts; those are now
  //    answered with a handled, retryable 503, so there is nothing left to go
  //    unhandled. Verified at concurrency 64, 128 and 256 with no cap: 0 crashes,
  //    0 transport errors, and no pool exhaustion at any of them.
  //
  // So the read path is protected by the things that cost nothing when unused —
  // the cache, pagination, and the retryable 503 — and this remains available for
  // a deployment that has nowhere else to shed load, such as one whose load
  // balancer does not rate-limit. READ_ADMISSION=on enables it.
  if (!/^(1|true|yes|on)$/i.test((process.env.READ_ADMISSION ?? '').trim())) {
    return { release: async () => undefined };
  }

  const maxInflight = readPositiveInt(process.env.READ_MAX_INFLIGHT, poolMax * 8);
  warnOnPoolMismatch(maxInflight, 'READ_MAX_INFLIGHT', poolMax);

  // A per-principal ceiling for fairness, opt-in for the same reason: a dashboard
  // legitimately parallelises, and a default here throttles real clients.
  const perPrincipal = readPositiveInt(process.env.READ_MAX_INFLIGHT_PER_PRINCIPAL, 0);
  // A rate ceiling nobody asked for is worse than none, because it is invisible:
  // it looks like concurrency protection. The first attempt derived one from the
  // inflight cap, and at 5,694 req/s offered it refused every request after the
  // first 1200 in the window. Opt-in only.
  const rateCeiling = readPositiveInt(process.env.READ_MAX_PER_MINUTE, 0);
  const maxRequests = rateCeiling > 0 ? rateCeiling : Number.MAX_SAFE_INTEGER;

  const { permit } = await acquirePermitPair({
    route: { scope: `gateway:read:${input.routeScope}`, principal: input.principal },
    global: { scope: 'gateway:reads:global', principal: 'global' },
    bounds: {
      minRequestsPerWindow: maxRequests,
      maxRequestsPerWindow: maxRequests,
      minInflight: Math.max(1, Math.floor(maxInflight / 4)),
      maxInflight,
      windowSeconds: readPositiveInt(process.env.READ_WINDOW_SECONDS, 60),
      inflightTtlSeconds: readPositiveInt(process.env.READ_INFLIGHT_TTL_SECONDS, 30),
      limitsCacheMs: Number.parseInt(process.env.READ_LIMITS_CACHE_MS ?? '2000', 10) || 0,
    },
    ...(perPrincipal > 0 ? { routeMaxInflight: perPrincipal } : {}),
  });
  return permit;
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
