import { beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  bumpComplaintReadCache,
  readCachedJson,
  readThroughCachedJson,
  writeCachedJson
} from '@roadwatch/redis';

/** The shape the route caches and serves. */
type Payload = { complaints: string[] };

/**
 * The authority complaint list gained a read cache, joining the citizen list which
 * already had one. A cache in front of a list that is filtered by the caller's
 * district scope is a data-leak risk, not just a staleness risk: if the key omits
 * the scope, the first officer to ask a question populates the entry and every
 * other officer is served rows they are not permitted to see.
 *
 * So the key must include the resolved access scope, and the scoping must be
 * testable. These run against a real Redis and skip cleanly without one.
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:16379/0';

let available = false;

beforeAll(async () => {
  const { getRedisClient } = await import('@roadwatch/redis');
  // The cache is only consulted when it is enabled *and* Redis is configured, and
  // the suite task does not load .env, so without this the suite silently skipped
  // everywhere except a developer shell that happened to have the variables set.
  // Pointed at the on-device instance, and left empty if one is already configured.
  process.env.REDIS_URL ??= 'redis://127.0.0.1:16379/0';
  process.env.REDIS_READ_CACHE ??= 'on';
  if (!/^(1|true|yes|on)$/i.test((process.env.REDIS_READ_CACHE ?? 'on').trim())) return;
  try {
    const client = getRedisClient();
    await client.ping();
    available = true;
  } catch {
    available = false;
  }
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async ctx => {
    if (!available) return ctx.skip();
    await fn();
  });

type Scope = {
  district: string | null;
  zone: string | null;
  status: string | null;
  limit: number;
  offset: number;
  role: string;
  districts: string[];
  zones: string[];
};

/** The cache part the route builds. Mirrors routes/authority.ts. */
function cachePartsFor(user: { role: string; districts: string[]; zones: string[] }, query: Partial<Scope> = {}): Scope {
  return {
    district: query.district ?? null,
    zone: query.zone ?? null,
    status: query.status ?? null,
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
    role: user.role,
    districts: user.districts ?? [],
    zones: user.zones ?? [],
  };
}

const CENTRAL = { role: 'CE', districts: ['ALL'], zones: ['ALL'] };
const MUMBAI_ONLY = { role: 'EE', districts: ['MUM'], zones: ['ALL'] };
const PUNE_ONLY = { role: 'EE', districts: ['PUN'], zones: ['ALL'] };

maybe('two officers with different district scopes get different entries', async () => {
  const key = `authority-complaints-list`;
  const shared = { district: null, zone: null, status: null, limit: 20, offset: 0 };

  await writeCachedJson(key, cachePartsFor(MUMBAI_ONLY, shared), { complaints: ['mum'] });
  await writeCachedJson(key, cachePartsFor(PUNE_ONLY, shared), { complaints: ['pun'] });

  // A different scope must not read the first officer's entry. If the key omitted
  // the district scope, this would return ['mum'] to the Pune officer.
  expect((await readCachedJson<Payload>(key, cachePartsFor(PUNE_ONLY, shared)))?.complaints).toEqual(['pun']);
  expect((await readCachedJson<Payload>(key, cachePartsFor(MUMBAI_ONLY, shared)))?.complaints).toEqual(['mum']);
});

maybe('a district-wide officer is not served a single-district officer entry', async () => {
  const key = `authority-complaints-list`;
  const shared = { district: null, zone: null, status: null, limit: 20, offset: 0 };

  await writeCachedJson(key, cachePartsFor(PUNE_ONLY, shared), { complaints: ['pun'] });

  const wide = await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, shared));
  // Either a distinct entry, or a miss. Never the narrow officer's rows.
  if (wide !== null) {
    expect(wide.complaints).not.toEqual(['pun']);
  }
});

maybe('an explicit district filter is part of the key', async () => {
  const key = `authority-complaints-list`;
  await writeCachedJson(key, cachePartsFor(CENTRAL, { district: 'PUN' }), { complaints: ['pun'] });
  await writeCachedJson(key, cachePartsFor(CENTRAL, { district: 'MUM' }), { complaints: ['mum'] });

  expect((await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, { district: 'PUN' })))?.complaints).toEqual(['pun']);
  expect((await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, { district: 'MUM' })))?.complaints).toEqual(['mum']);
});

/**
 * Pagination is in the key, or page 2 would be served page 1's rows — the same
 * class of bug as the limit that was ignored, and it is the one most likely to be
 * reintroduced because it looks like a detail.
 */
maybe('limit and offset are part of the key', async () => {
  const key = `authority-complaints-list`;
  const base = { district: null, zone: null, status: null };

  await writeCachedJson(key, cachePartsFor(CENTRAL, { ...base, limit: 20, offset: 0 }), { complaints: ['p1'] });
  await writeCachedJson(key, cachePartsFor(CENTRAL, { ...base, limit: 20, offset: 20 }), { complaints: ['p2'] });
  await writeCachedJson(key, cachePartsFor(CENTRAL, { ...base, limit: 50, offset: 0 }), { complaints: ['big'] } satisfies Payload);

  expect((await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, { ...base, limit: 20, offset: 0 })))?.complaints).toEqual(['p1']);
  expect((await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, { ...base, limit: 20, offset: 20 })))?.complaints).toEqual(['p2']);
  expect((await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, { ...base, limit: 50, offset: 0 })))?.complaints).toEqual(['big']);
});

maybe('status filter is part of the key', async () => {
  const key = `authority-complaints-list`;
  const base = { district: null, zone: null, limit: 20, offset: 0 };
  await writeCachedJson(key, cachePartsFor(CENTRAL, { ...base, status: 'FILED' }), { complaints: ['filed'] });
  await writeCachedJson(key, cachePartsFor(CENTRAL, { ...base, status: 'RESOLVED' }), { complaints: ['resolved'] });

  expect((await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, { ...base, status: 'FILED' })))?.complaints).toEqual(['filed']);
  expect((await readCachedJson<Payload>(key, cachePartsFor(CENTRAL, { ...base, status: 'RESOLVED' })))?.complaints).toEqual(['resolved']);
});

/**
 * Single-flight fill.
 *
 * Every complaint write bumps the cache generation, which orphans every cached
 * list. Without coordination, every read request in flight at that moment misses
 * and runs the full origin query: measured at 4.1 misses per bump with 32 read
 * workers, with the hit rate falling from 99.88% read-only to 7.8-15.5% under
 * write load. `readThroughCachedJson` collapses those concurrent misses into one
 * fill, so the number of origin queries per bump is 1 rather than the number of
 * readers.
 */
maybe('concurrent misses for one key run the fill once', async () => {
  const key = `single-flight-${Date.now()}`;
  const parts = cachePartsFor(CENTRAL);
  let fills = 0;
  const fill = async () => {
    fills += 1;
    // Long enough that every caller is waiting on the same in-flight promise.
    await new Promise((r) => setTimeout(r, 50));
    return { complaints: [`fill-${fills}`] } satisfies Payload;
  };

  const results = await Promise.all(
    Array.from({ length: 24 }, () => readThroughCachedJson<Payload>(key, parts, fill))
  );

  // One origin query, not 24.
  expect(fills).toBe(1);
  // Every caller gets the same value, so a waiter is never served an empty body.
  for (const r of results) expect(r.complaints).toEqual(['fill-1']);
});

maybe('distinct scopes are not collapsed into one fill', async () => {
  const key = `single-flight-scope-${Date.now()}`;
  const shared = { district: null, zone: null, status: null, limit: 20, offset: 0 };
  const mum = cachePartsFor(MUMBAI_ONLY, shared);
  const pun = cachePartsFor(PUNE_ONLY, shared);

  const mumFill = readThroughCachedJson<Payload>(key, mum, async () => {
    await new Promise((r) => setTimeout(r, 40));
    return { complaints: ['mum'] };
  });
  const punFill = readThroughCachedJson<Payload>(key, pun, async () => {
    await new Promise((r) => setTimeout(r, 40));
    return { complaints: ['pun'] };
  });

  // Single-flight must not become a cross-scope leak: two different officers'
  // fills have to stay separate even when they overlap in time.
  expect((await mumFill).complaints).toEqual(['mum']);
  expect((await punFill).complaints).toEqual(['pun']);
});

/**
 * The stampede itself, at the layer the measurements instrumented.
 *
 * A generation bump orphans every cached list, so a burst of readers arriving
 * right after a write all miss together. Before the single-flight fill that was
 * 4.1 origin queries per bump with 32 readers; it is now 1. The count below is
 * what the load harness in `docs/CAPACITY.md` §8.3 measures, so if this
 * regresses the capacity number regresses with it.
 */
maybe('a generation bump followed by a read burst costs one origin query', async () => {
  const key = `stampede-${Date.now()}`;
  const parts = cachePartsFor(CENTRAL);
  const READERS = 32;

  let fills = 0;
  const fill = async () => {
    fills += 1;
    await new Promise((r) => setTimeout(r, 40));
    return { complaints: [`n${fills}`] } satisfies Payload;
  };

  // Warm it, then invalidate exactly as a complaint write would.
  await readThroughCachedJson<Payload>(key, parts, fill);
  await bumpComplaintReadCache();

  const before = fills;
  await Promise.all(
    Array.from({ length: READERS }, () => readThroughCachedJson<Payload>(key, parts, fill))
  );

  // One fill for the whole burst. Pre-fix this was ~READERS/8, measured at 4.1.
  expect(fills - before).toBe(1);
});

maybe('a failed fill is not cached and does not poison later readers', async () => {
  const key = `single-flight-fail-${Date.now()}`;
  const parts = cachePartsFor(CENTRAL);
  let calls = 0;

  // The origin fails once, then recovers. The first caller sees the error, which
  // is correct — it is the one that actually got the failure. What must not
  // happen is the error being cached as a value, or the in-flight entry being
  // left behind so that later readers keep joining a dead fill.
  const flakyFill = async (): Promise<Payload> => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    if (calls === 1) throw new Error('origin down');
    return { complaints: ['recovered'] };
  };

  const first = await readThroughCachedJson<Payload>(key, parts, flakyFill).catch((e) => e);
  expect(first).toBeInstanceOf(Error);

  const second = await readThroughCachedJson<Payload>(key, parts, flakyFill);
  expect(second.complaints).toEqual(['recovered']);
  // The recovered value is now cached, so a third read is served from it.
  const third = await readThroughCachedJson<Payload>(key, parts, flakyFill);
  expect(third.complaints).toEqual(['recovered']);
  expect(calls).toBe(2);
});

maybe('waiters do not inherit the leader failure', async () => {
  const key = `single-flight-waiter-fail-${Date.now()}`;
  const parts = cachePartsFor(CENTRAL);
  let calls = 0;

  // The leader's fill fails; a waiter arriving behind it must run its own fill
  // rather than being handed the leader's error, so a briefly unhealthy origin
  // turns into one reported failure rather than N of them.
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      readThroughCachedJson<Payload>(key, parts, async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 30));
        if (calls === 1) throw new Error('origin down');
        return { complaints: ['ok'] };
      })
    )
  );

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  // At least the leader fails; the point is that not all of them do.
  expect(fulfilled.length).toBeGreaterThan(0);
  expect(results.length - fulfilled.length).toBeLessThan(results.length);
});

/**
 * Freshness is not weakened by the single-flight. The key still carries the
 * generation, so a read issued *after* a write must miss and refill rather than
 * being served the pre-write entry.
 */
maybe('a read after a write still refills', async () => {
  const key = `single-flight-freshness-${Date.now()}`;
  const parts = cachePartsFor(CENTRAL);

  const first = await readThroughCachedJson<Payload>(key, parts, async () => ({ complaints: ['before'] }));
  expect(first.complaints).toEqual(['before']);

  await bumpComplaintReadCache();

  const after = await readThroughCachedJson<Payload>(key, parts, async () => ({ complaints: ['after'] }));
  expect(after.complaints).toEqual(['after']);
});

maybe('a second read after the fill is a hit and does not refill', async () => {
  const key = `single-flight-hit-${Date.now()}`;
  const parts = cachePartsFor(CENTRAL);
  let fills = 0;
  const fill = async () => {
    fills += 1;
    return { complaints: [`v${fills}`] } satisfies Payload;
  };

  await readThroughCachedJson<Payload>(key, parts, fill);
  const second = await readThroughCachedJson<Payload>(key, parts, fill);

  expect(fills).toBe(1);
  expect(second.complaints).toEqual(['v1']);
});
