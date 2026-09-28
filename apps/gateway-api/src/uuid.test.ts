import { describe, expect, it } from 'vitest';
import { __resetUuidPool, uuidv7 } from './uuid.js';

/**
 * A v7 id is used as a primary key and as a cursor, so the format has to stay
 * exactly RFC 9562 conformant. The batching and formatting changes here are
 * optimisations; if they altered the output, every id in the database would be
 * subtly wrong in a way no other test would notice.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces a version 7 id in the canonical form', () => {
    expect(uuidv7()).toMatch(UUID_RE);
  });

  it('is still canonical after many pool refills', () => {
    // The pool hands out 4 KB in 16-byte slices, so this crosses several refill
    // boundaries. A formatting bug that only appears on a block boundary — an
    // off-by-one in the hyphen positions — would be invisible otherwise.
    for (let i = 0; i < 1000; i += 1) {
      expect(uuidv7()).toMatch(UUID_RE);
    }
  });

  it('carries the current timestamp in its high 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    // The first 12 hex digits are the millisecond timestamp.
    const ms = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  /**
   * v7 gives non-decreasing *timestamps*, which is what makes inserts land at the
   * end of the index. It deliberately does not give total ordering within one
   * millisecond — the remaining bits are random, not monotonic — so asserting that
   * 500 ids generated in a tight loop come out sorted would be asserting
   * something the spec does not promise. RFC 9562 offers an optional monotonic
   * random mode for that; this is not it.
   */
  it('never goes backwards in time', () => {
    const stamps = Array.from({ length: 500 }, () =>
      Number.parseInt(uuidv7().replace(/-/g, '').slice(0, 12), 16),
    );
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]!).toBeGreaterThanOrEqual(stamps[i - 1]!);
    }
  });

  it('does not repeat, across pool refills', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    // 5000 ids x 62 random bits: a collision is not merely unlikely, it is
    // effectively impossible, so a shortfall means the random bytes are being
    // reused rather than drawn.
    expect(ids.size).toBe(5000);
  });

  it('recovers after the pool is dropped', () => {
    const first = uuidv7();
    __resetUuidPool();
    expect(uuidv7()).toMatch(UUID_RE);
    expect(uuidv7()).not.toBe(first);
  });
});
