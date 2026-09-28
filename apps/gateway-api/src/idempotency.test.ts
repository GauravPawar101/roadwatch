import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the orphaned-claim defect.
 *
 * A claim is written before the business transaction and completed after it.
 * Anything that threw in between left the row with response_code IS NULL, and
 * nothing ever cleaned it up. Because auto-derived keys hash the request body,
 * the caller could not work around the resulting 409 by resending — any change
 * to the payload derives a different key, so the original request became
 * permanently unwritable. Reproduced end to end against a real database; these
 * pin the recovery path.
 */

// vi.mock factories are hoisted above module-level declarations, so the mock
// has to be created with vi.hoisted for the factory to close over it.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./postgres.js', () => ({ pool: { query } }));

import { claimIdempotency, releaseIdempotencyKey, type IdempotencyClaim } from './idempotency.js';

const SCOPE = 'authority:complaints:create';
const KEY = 'auto:test-key';
const HASH = 'hash-1';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Builds a `pool.query` mock for a claim that already exists and is incomplete. */
function mockExisting(overrides: { requestHash?: string; responseCode?: number | null; responseBody?: unknown } = {}) {
  query
    // 1. INSERT ... ON CONFLICT DO NOTHING -> conflict, we did not create it
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    // 2. SELECT the existing row
    .mockResolvedValueOnce({
      rows: [{
        request_hash: overrides.requestHash ?? HASH,
        response_code: overrides.responseCode ?? null,
        response_body: overrides.responseBody ?? null,
        updated_at: new Date(),
      }],
    });
}

describe('claimIdempotency', () => {
  it('grants a claim when the key is new', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const claim = await claimIdempotency(SCOPE, KEY, HASH);

    expect(claim).toEqual({ scope: SCOPE, key: KEY, requestHash: HASH });
    // A fresh claim must not pay for the extra round-trips.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('replays a completed claim', async () => {
    mockExisting({ responseCode: 200, responseBody: { ok: true } });

    const result = await claimIdempotency(SCOPE, KEY, HASH);

    expect(result).toEqual({ replay: true, statusCode: 200, body: { ok: true } });
  });

  it('rejects reuse of a key with a different payload', async () => {
    mockExisting({ requestHash: 'a-different-hash', responseCode: 200, responseBody: { ok: true } });

    const result = await claimIdempotency(SCOPE, KEY, HASH);

    expect(result).toMatchObject({ replay: true, statusCode: 409 });
    expect((result as { body: { error: string } }).body.error).toMatch(/different request payload/);
  });

  it('refuses a genuinely in-flight claim, and says how long to wait', async () => {
    // Incomplete but not stale: the conditional UPDATE matches nothing.
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ request_hash: HASH, response_code: null, response_body: null, updated_at: new Date() }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await claimIdempotency(SCOPE, KEY, HASH);

    expect(result).toMatchObject({ replay: true, statusCode: 409 });
    expect((result as { body: { retryAfterSeconds: number } }).body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('reclaims a claim orphaned past the TTL', async () => {
    // Incomplete and stale: the conditional UPDATE matches exactly one row.
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ request_hash: HASH, response_code: null, response_body: null, updated_at: new Date(0) }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const claim = await claimIdempotency(SCOPE, KEY, HASH);

    expect(claim).toEqual({ scope: SCOPE, key: KEY, requestHash: HASH });
  });

  /**
   * The reclaim is a conditional UPDATE whose rowCount decides ownership, so
   * two concurrent retries cannot both proceed. If it were a read-then-write,
   * both would see a stale row and both would run the business transaction.
   */
  it('decides reclaim ownership from the UPDATE row count', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ request_hash: HASH, response_code: null, response_body: null, updated_at: new Date(0) }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await claimIdempotency(SCOPE, KEY, HASH);

    // Lost the race: must not be granted the claim.
    expect(result).toMatchObject({ replay: true, statusCode: 409 });
  });

  it('scopes the reclaim to an incomplete claim only', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ request_hash: HASH, response_code: null, response_body: null, updated_at: new Date(0) }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await claimIdempotency(SCOPE, KEY, HASH);

    const sql = query.mock.calls[2]![0] as string;
    // Never reclaim a claim that already has a stored result, and never touch
    // a row another request refreshed.
    expect(sql).toMatch(/response_code IS NULL/);
    expect(sql).toMatch(/updated_at < NOW\(\)/);
  });
});

describe('releaseIdempotencyKey', () => {
  it('deletes only the incomplete claim for that scope and key', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const claim: IdempotencyClaim = { scope: SCOPE, key: KEY, requestHash: HASH };
    await releaseIdempotencyKey(claim);

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/DELETE FROM api_idempotency_keys/);
    // Guarding on response_code IS NULL means a result stored between the
    // failure and the release is preserved rather than deleted.
    expect(sql).toMatch(/response_code IS NULL/);
    expect(params).toEqual([SCOPE, KEY]);
  });

  it('swallows a release failure rather than masking the original error', async () => {
    query.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      releaseIdempotencyKey({ scope: SCOPE, key: KEY, requestHash: HASH }),
    ).resolves.toBeUndefined();
  });
});
