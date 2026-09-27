import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { acquireAdmission, admissionRejection, permitKeys } from './admission.js';

/**
 * These run against a real Redis, because the property under test is the script's
 * atomicity. A mock would only re-state the intent: the previous implementation
 * was four separate commands, and whether two concurrent requests can both pass
 * an inflight check is precisely what a single-threaded fake cannot answer.
 *
 * Skip automatically when no Redis is reachable, so the suite stays runnable on a
 * machine without the on-device stack.
 */

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:16379/0';

let redis: Redis | null = null;
let available = false;

const permit = (scope: string, principal: string, over: Partial<Limits> = {}) => ({
  scope,
  principal,
  maxRequestsPerWindow: over.maxRequestsPerWindow ?? 1000,
  windowSeconds: over.windowSeconds ?? 60,
  maxInflight: over.maxInflight ?? 1000,
  inflightTtlSeconds: over.inflightTtlSeconds ?? 120,
});

type Limits = {
  maxRequestsPerWindow: number;
  windowSeconds: number;
  maxInflight: number;
  inflightTtlSeconds: number;
};

const counter = async (key: string): Promise<number> =>
  Number((await redis!.get(key)) ?? '0');

beforeAll(async () => {
  const candidate = new Redis(URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  try {
    await candidate.connect();
    await candidate.ping();
    available = true;
    redis = candidate;
  } catch {
    available = false;
    candidate.disconnect();
  }
});

afterAll(async () => {
  if (redis) await redis.quit().catch(() => undefined);
});

beforeEach(async () => {
  if (!available || !redis) return;
  const keys = await redis.keys('roadwatch:backpressure:test:*');
  if (keys.length > 0) await redis.del(...keys);
});

/** The suite is meaningful only against a real Redis; skip rather than pretend. */
const maybe = (name: string, fn: () => Promise<void> | void) =>
  it(name, async (ctx) => {
    if (!available) return ctx.skip();
    await fn();
  });

describe('acquireAdmission', () => {
  maybe('admits within limits and increments both counters', async () => {
    const p = permit('test:route', 'u1');
    const g = permit('test:global', 'global');
    const keys = permitKeys(p);

    const admission = await acquireAdmission(redis!, [p, g], ['route', 'global']);
    expect(admission.outcome).toEqual({ admitted: true });

    expect(await counter(keys.rateKey)).toBe(1);
    expect(await counter(keys.inflightKey)).toBe(1);
    await admission.release();
  });

  maybe('releases both inflight counters and leaves the rate counter', async () => {
    const p = permit('test:route', 'u1');
    const g = permit('test:global', 'global');
    const keys = permitKeys(p);
    const globalKeys = permitKeys(g);

    const admission = await acquireAdmission(redis!, [p, g]);
    await admission.release();

    expect(await counter(keys.inflightKey)).toBe(0);
    expect(await counter(globalKeys.inflightKey)).toBe(0);
    // The rate counter is a window total, not a concurrency count, so it is not
    // decremented on release.
    expect(await counter(keys.rateKey)).toBe(1);
  });

  maybe('refuses a rate-limited write and leaves no counter inflated', async () => {
    const p = permit('test:route', 'u1', { maxRequestsPerWindow: 2 });
    const g = permit('test:global', 'global');
    const keys = permitKeys(p);

    // Both admitted writes are released, so the only counts left afterwards are
    // the ones the refusal should and should not have changed.
    const first = await acquireAdmission(redis!, [p, g]);
    await first.release();
    const second = await acquireAdmission(redis!, [p, g]);
    await second.release();

    const third = await acquireAdmission(redis!, [p, g], ['route', 'global']);
    expect(third.outcome.admitted).toBe(false);
    expect(third.outcome.rejection).toBe('rate');
    expect(third.outcome.permit).toBe('route');

    // A refused write must not be charged: the rate counter is rolled back so
    // the window reflects requests actually admitted, and the inflight counter
    // is untouched because nothing was served.
    expect(await counter(keys.rateKey)).toBe(2);
    expect(await counter(keys.inflightKey)).toBe(0);
  });

  /**
   * The counter must be exact, not merely the admission decision.
   *
   * The previous implementation incremented, compared the value INCR returned,
   * and decremented again when over the limit. The admitted count was correct —
   * the returned value is exact, so no two requests can pass the same check —
   * but the counter reported every un-rolled-back refusal.
   */
  maybe('keeps the inflight counter exact under a concurrent storm', async () => {
    const maxInflight = 5;
    const p = permit('test:route', 'u1', { maxInflight });
    const g = permit('test:global', 'global', { maxInflight });
    const keys = permitKeys(p);

    const results = await Promise.all(
      Array.from({ length: 40 }, () => acquireAdmission(redis!, [p, g])),
    );

    const admitted = results.filter(r => r.outcome.admitted);
    expect(admitted).toHaveLength(maxInflight);

    // Sampled while the admitted permits are still held, so this is the peak
    // rather than a post-release reading. The previous implementation reached 40
    // here with a cap of 5, because every refused request had incremented and
    // not yet rolled back — a second replica reading that counter would refuse
    // valid writes until the backlog drained.
    expect(await counter(keys.inflightKey)).toBe(maxInflight);
    // The rate counter must likewise show only writes that were admitted.
    expect(await counter(keys.rateKey)).toBe(maxInflight);

    await Promise.all(admitted.map(r => r.release()));
    expect(await counter(keys.inflightKey)).toBe(0);
  });

  maybe('rolls back the route permit when the global permit refuses', async () => {
    // The route permit is taken first, so a global refusal has to undo it or the
    // route's inflight count leaks and capacity is lost with no write served.
    const p = permit('test:route', 'u1', { maxInflight: 10 });
    const g = permit('test:global', 'global', { maxInflight: 0 });
    const keys = permitKeys(p);
    const globalKeys = permitKeys(g);

    const outcome = await acquireAdmission(redis!, [p, g], ['route', 'global']);
    expect(outcome.outcome.admitted).toBe(false);
    expect(outcome.outcome.permit).toBe('global');

    expect(await counter(keys.inflightKey)).toBe(0);
    expect(await counter(globalKeys.inflightKey)).toBe(0);
    expect(await counter(keys.rateKey)).toBe(0);
  });

  maybe('sets an expiry on the rate key only when the window opens', async () => {
    const p = permit('test:route', 'u1', { windowSeconds: 45 });
    const g = permit('test:global', 'global');
    const keys = permitKeys(p);

    const first = await acquireAdmission(redis!, [p, g]);
    const ttlAfterFirst = await redis!.ttl(keys.rateKey);
    await first.release();

    // A busy principal must not keep pushing the expiry forward, or the window
    // would never close and the limit would become permanent.
    const second = await acquireAdmission(redis!, [p, g]);
    const ttlAfterSecond = await redis!.ttl(keys.rateKey);
    await second.release();

    expect(ttlAfterFirst).toBeGreaterThan(0);
    expect(ttlAfterFirst).toBeLessThanOrEqual(45);
    expect(ttlAfterSecond).toBeLessThanOrEqual(ttlAfterFirst);
  });

  maybe('bounds an orphaned permit by the inflight TTL', async () => {
    const p = permit('test:route', 'u1', { inflightTtlSeconds: 30 });
    const g = permit('test:global', 'global');
    const keys = permitKeys(p);

    // Acquire and never release, as a process that died holding a permit would.
    await acquireAdmission(redis!, [p, g]);
    expect(await redis!.ttl(keys.inflightKey)).toBeGreaterThan(0);
    expect(await redis!.ttl(keys.inflightKey)).toBeLessThanOrEqual(30);
  });

  maybe('admitting a single permit behaves like the pair', async () => {
    const p = permit('test:solo', 'u1', { maxRequestsPerWindow: 1 });
    const keys = permitKeys(p);

    const first = await acquireAdmission(redis!, [p]);
    expect(first.outcome.admitted).toBe(true);

    const second = await acquireAdmission(redis!, [p]);
    expect(second.outcome.admitted).toBe(false);
    expect(second.outcome.rejection).toBe('rate');

    // The first permit is still held — it was never released — so the count is
    // 1. The refused attempt must leave it exactly there: the rate check runs
    // before the inflight increment, so there is nothing of its own to undo.
    expect(await counter(keys.inflightKey)).toBe(1);
    expect(await counter(keys.rateKey)).toBe(1);

    await first.release();
    expect(await counter(keys.inflightKey)).toBe(0);
  });

  maybe('treats an empty permit list as admitted and needs no Redis call', async () => {
    const admission = await acquireAdmission(redis!, []);
    expect(admission.outcome.admitted).toBe(true);
    await expect(admission.release()).resolves.toBeUndefined();
  });
});

describe('admissionRejection', () => {
  it('carries a 429 and a bounded retry for a rate refusal', () => {
    const error = admissionRejection(
      { admitted: false, rejection: 'rate', permit: 'route', retryAfterSeconds: 60 },
      'rate',
    ) as unknown as Record<string, unknown>;

    expect(error.statusCode).toBe(429);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.permit).toBe('route');
    expect((error as { message: string }).message).toMatch(/Rate limit/);
  });

  it('never advertises a wait of zero, which would invite an immediate retry', () => {
    const error = admissionRejection(
      { admitted: false, rejection: 'inflight', permit: 'global', retryAfterSeconds: 0 },
      'inflight',
    ) as unknown as Record<string, unknown>;

    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect((error as { message: string }).message).toMatch(/backlog/);
  });
});
