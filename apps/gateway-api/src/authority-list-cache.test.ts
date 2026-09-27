import { beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readCachedJson, writeCachedJson } from '@roadwatch/redis';

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
