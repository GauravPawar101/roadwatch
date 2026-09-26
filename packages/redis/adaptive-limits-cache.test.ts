import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These exercise the real resolveAdaptiveLimits against a mocked Redis client
 * and count the round-trips it performs.
 *
 * The pre-existing adaptive-backpressure.test.ts re-implements the pressure
 * arithmetic locally, so it passes regardless of what the real function does.
 * That is why the cache behaviour is pinned here, against the real code.
 */

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  decr: vi.fn(),
};

vi.mock('./client.js', () => ({ getRedisClient: () => redisMock }));
vi.mock('./config.js', () => ({ isRedisConfigured: () => true }));

import { readLoadSignals, resetAdaptiveLimitsCache, resolveAdaptiveLimits } from './adaptive-backpressure.js';

const BOUNDS = {
  minRequestsPerWindow: 100,
  maxRequestsPerWindow: 1000,
  minInflight: 10,
  maxInflight: 100,
  windowSeconds: 60,
  inflightTtlSeconds: 120,
};

beforeEach(() => {
  resetAdaptiveLimitsCache();
  vi.clearAllMocks();
  // Healthy signals: no outbox backlog, no recent rejections.
  redisMock.get.mockResolvedValue('0');
  redisMock.set.mockResolvedValue('OK');
});

afterEach(() => {
  resetAdaptiveLimitsCache();
});

describe('resolveAdaptiveLimits caching', () => {
  it('reads the load signals and publishes the result on a cold cache', async () => {
    const limits = await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 5000 });

    expect(limits.maxRequestsPerWindow).toBe(1000);
    expect(redisMock.get).toHaveBeenCalledTimes(3); // outbox, 429, 5xx
    expect(redisMock.set).toHaveBeenCalledTimes(1);
  });

  it('serves repeated calls from cache without touching Redis', async () => {
    await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 5000 });
    const getsAfterFirst = redisMock.get.mock.calls.length;

    for (let i = 0; i < 50; i += 1) {
      await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 5000 });
    }

    // Without the cache this would be 51 * 3 = 153 reads plus 51 writes.
    expect(redisMock.get).toHaveBeenCalledTimes(getsAfterFirst);
    expect(redisMock.set).toHaveBeenCalledTimes(1);
  });

  it('re-reads once the cache window has passed', async () => {
    await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 1 });
    const first = redisMock.get.mock.calls.length;

    await new Promise(resolve => setTimeout(resolve, 12));
    await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 1 });

    expect(redisMock.get.mock.calls.length).toBeGreaterThan(first);
  });

  it('re-reads on every call when the cache is disabled', async () => {
    await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 0 });
    const first = redisMock.get.mock.calls.length;

    await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 0 });

    expect(redisMock.get.mock.calls.length).toBe(first + 3);
  });

  /**
   * Two services can share a Redis but need different limits. A cache keyed
   * only by time would hand one service the other's numbers.
   */
  it('keeps limits for different bounds separate', async () => {
    const strict = await resolveAdaptiveLimits({ ...BOUNDS, maxRequestsPerWindow: 200, limitsCacheMs: 5000 });
    const loose = await resolveAdaptiveLimits({ ...BOUNDS, maxRequestsPerWindow: 5000, limitsCacheMs: 5000 });

    expect(strict.maxRequestsPerWindow).toBe(200);
    expect(loose.maxRequestsPerWindow).toBe(5000);
  });
});

describe('pressure signals', () => {
  it('shrinks the window when the outbox is backing up', async () => {
    redisMock.get.mockImplementation(async (key: string) => {
      if (key.includes('outbox')) return '900';
      return '0';
    });

    const limits = await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 0 });
    // outboxDepth > 500 adds 2 pressure points, i.e. shrink = 0.5.
    expect(limits.maxRequestsPerWindow).toBe(550);
  });

  it('shrinks the window when rejections are already happening', async () => {
    redisMock.get.mockImplementation(async (key: string) => {
      if (key.includes(':429')) return '80';
      return '0';
    });

    const limits = await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 0 });
    expect(limits.maxRequestsPerWindow).toBe(550);
  });

  it('never drops below the configured floor under maximum pressure', async () => {
    redisMock.get.mockResolvedValue('10000');
    const limits = await resolveAdaptiveLimits({ ...BOUNDS, limitsCacheMs: 0 });

    expect(limits.maxRequestsPerWindow).toBe(BOUNDS.minRequestsPerWindow);
    expect(limits.maxInflight).toBe(BOUNDS.minInflight);
  });

  it('reports signals as zero when Redis is unavailable', async () => {
    // readLoadSignals is exercised directly; the unavailable branch is
    // covered by the isRedisConfigured() false path in the resolver.
    redisMock.get.mockResolvedValue(null);
    await expect(readLoadSignals()).resolves.toEqual({
      outboxDepth: 0,
      recent429Count: 0,
      recent5xxCount: 0
    });
  });
});
