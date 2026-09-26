import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: mock the client so these run without a live Redis.
const store = new Map<string, string>();

const redisMock = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  get: vi.fn(),
  incr: vi.fn(),
  exists: vi.fn(),
  ttl: vi.fn(),
}));

vi.mock('./client.js', () => ({ getRedisClient: () => redisMock }));
vi.mock('./config.js', () => ({ isRedisConfigured: () => true }));

import { claimIdempotencyKey, releaseIdempotencyKey } from './idempotency.js';

/** Emulate `SET key value EX ttl NX` — returns 'OK' only when the key is new. */
function setNx(key: string, value: string, _ex: string, _ttl: number, _nx: string) {
  if (store.has(key)) return null;
  store.set(key, value);
  return 'OK';
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redisMock.set.mockImplementation(setNx);
  redisMock.del.mockImplementation((key: string) => (store.delete(key) ? 1 : 0));
});

describe('claimIdempotencyKey', () => {
  it('claims a fresh key', async () => {
    const result = await claimIdempotencyKey('k1', 60);
    expect(result).toEqual({ ok: true, claimed: true });
    expect(store.get('k1')).toBe('1');
  });

  it('reports a duplicate for an already-claimed key', async () => {
    await claimIdempotencyKey('k1', 60);
    const second = await claimIdempotencyKey('k1', 60);
    expect(second).toEqual({ ok: true, claimed: false });
  });

  it('keeps distinct keys independent', async () => {
    await claimIdempotencyKey('a', 60);
    const other = await claimIdempotencyKey('b', 60);
    expect(other.claimed).toBe(true);
  });
});

describe('releaseIdempotencyKey', () => {
  it('removes the claim so the work can be retried', async () => {
    await claimIdempotencyKey('k1', 60);
    expect(store.has('k1')).toBe(true);

    await releaseIdempotencyKey('k1');

    expect(store.has('k1')).toBe(false);
    const requeued = await claimIdempotencyKey('k1', 60);
    expect(requeued.claimed).toBe(true);
  });

  it('is a no-op for a key that was never claimed', async () => {
    await expect(releaseIdempotencyKey('never-existed')).resolves.toBeUndefined();
  });
});

/**
 * Regression guard for the webhook-handler bug: a claim taken *before* the work
 * and never released on failure makes every redelivery look like a duplicate,
 * so the message is dropped after a single transient error.
 */
describe('claim/release retry cycle (webhook dedupe contract)', () => {
  it('allows a redelivery to be re-processed after a failure', async () => {
    const key = 'roadwatch:webhook:idempotency:complaint-status-changed:0:103';

    const delivery1 = await claimIdempotencyKey(key, 86_400);
    expect(delivery1.claimed).toBe(true);

    // processing throws -> handler releases the claim
    await releaseIdempotencyKey(key);

    const delivery2 = await claimIdempotencyKey(key, 86_400);
    expect(delivery2.claimed).toBe(true);
  });

  it('suppresses a redelivery after SUCCESS (the dedupe guarantee still holds)', async () => {
    const key = 'roadwatch:webhook:idempotency:complaint-submitted:0:100';

    await claimIdempotencyKey(key, 86_400); // processed successfully, claim kept
    const redelivery = await claimIdempotencyKey(key, 86_400);

    expect(redelivery.claimed).toBe(false);
  });

  it('does not let one event suppress a different event for the same complaint', async () => {
    // Dedupe is keyed on topic:partition:offset, NOT on the business key, so
    // several status changes for one complaint each get their own claim.
    const offsets = [101, 102, 103];
    const claims = await Promise.all(
      offsets.map((o) => claimIdempotencyKey(`roadwatch:webhook:idempotency:complaint-status-changed:0:${o}`, 86_400))
    );
    expect(claims.every((c) => c.claimed)).toBe(true);
  });
});
