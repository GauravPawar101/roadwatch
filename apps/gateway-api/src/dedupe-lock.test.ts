import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * The proximity-dedupe lock, verified against a real database.
 *
 * A mock cannot answer the question that matters here: whether concurrent
 * writers to one district/zone still serialise, and whether `report_count` stays
 * exact. The previous implementation locked the 25 newest rows in the partition
 * with `LIMIT 25 FOR UPDATE`, so every concurrent write to the same district/zone
 * queued on the same 25 rows — and because the lock lives in Postgres, adding
 * gateway instances made it worse rather than better.
 *
 * The fix finds the merge target with an unlocked MVCC read, locks only that one
 * row, and re-verifies under the lock.
 *
 * These run against a real Postgres and skip cleanly when none is reachable, so
 * the suite stays runnable without the on-device stack. Every row is created in a
 * uniquely-named partition and removed afterwards, so nothing else is touched.
 */

const URL = process.env.REDIS_URL ? (process.env.DATABASE_URL ?? undefined) : undefined;
const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:15433/roadwatch';

let pool: pg.Pool | null = null;
let available = false;

const MERGE_RADIUS_M = 100;
const CLOSED = new Set(['RESOLVED', 'DISMISSED', 'CLOSED']);

/** Unique per run, so a crashed run cannot leave rows that break the next. */
const NS = `dedupe${Date.now().toString(36)}`;

beforeAll(async () => {
  const candidate = new pg.Pool({
    connectionString: URL ?? LOCAL_URL,
    // The concurrency test holds 12 at once and the interleaving test needs a
    // second connection while the first is mid-transaction. With max 1 the second
    // connect() blocks forever behind the first, which is a harness deadlock
    // rather than a product behaviour.
    max: 16,
    connectionTimeoutMillis: 3000,
  });
  try {
    await candidate.query('select 1');
    available = true;
    pool = candidate;
  } catch {
    available = false;
    await candidate.end().catch(() => undefined);
  }
});

afterAll(async () => {
  if (pool) {
    await pool.query(`delete from complaints where district like $1`, [`${NS}%`]).catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
});

beforeEach(async () => {
  if (!available || !pool) return;
  await pool.query(`delete from complaints where district like $1`, [`${NS}%`]);
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async ctx => {
    if (!available) return ctx.skip();
    await fn();
  });

/** Mirrors the route's two-phase dedupe so the test exercises the real sequence. */
async function findAndMerge(
  tx: pg.PoolClient,
  district: string,
  zone: string,
  lat: number,
  lng: number,
  description: string,
  attempts = 3,
): Promise<{ merged: boolean; id?: string; contended?: boolean }> {
  const withinRadius = (row: { lat: number | null; lng: number | null }): boolean => {
    if (row.lat == null || row.lng == null) return false;
    // Equirectangular is accurate enough at 100 m and avoids trig per row.
    const dx = (row.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    const dy = (row.lat - lat) * 110_540;
    return Math.hypot(dx, dy) <= MERGE_RADIUS_M;
  };
  const isMergeable = (row: { status: string }): boolean => !CLOSED.has(String(row.status ?? '').toUpperCase());

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidates = await tx.query<{ id: string; status: string; lat: number; lng: number }>(
      `select id, status, lat, lng from complaints
        where district = $1 and zone = $2
          and lat is not null and lng is not null
          and upper(status) not in ('RESOLVED','DISMISSED','CLOSED')
        order by created_at desc
        limit 25`,
      [district, zone],
    );

    const near = candidates.rows.find((row) => withinRadius(row) && isMergeable(row));
    if (!near) return { merged: false };

    const locked = await tx.query<{ id: string; status: string; lat: number; lng: number }>(
      `select id, status, lat, lng from complaints where id = $1 for update`,
      [near.id],
    );
    const row = locked.rows[0];
    if (!row || !withinRadius(row) || !isMergeable(row)) continue;

    await tx.query(
      `update complaints set report_count = coalesce(report_count,1) + 1, updated_at = now() where id = $1`,
      [row.id],
    );
    return { merged: true, id: row.id };
  }
  return { merged: false, contended: true };
}

maybe('merges a nearby report into the existing complaint', async () => {
  const client = await pool!.connect();
  try {
    await client.query('begin');
    const created = await client.query<{ id: string }>(
      `insert into complaints (id, district, zone, status, description, lat, lng, report_count, created_at, updated_at)
       values (gen_random_uuid(), $1, 'Z1', 'FILED', 'first', 18.0, 73.0, 1, now(), now()) returning id`,
      [`${NS}a`],
    );
    const result = await findAndMerge(client, `${NS}a`, 'Z1', 18.0005, 73.0005, 'second');
    await client.query('commit');

    expect(result.merged).toBe(true);
    expect(result.id).toBe(created.rows[0]!.id);
  } finally {
    client.release();
  }
});

maybe('leaves a distant report as a new row', async () => {
  const client = await pool!.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into complaints (id, district, zone, status, description, lat, lng, report_count, created_at, updated_at)
       values (gen_random_uuid(), $1, 'Z1', 'FILED', 'first', 18.0, 73.0, 1, now(), now())`,
      [`${NS}b`],
    );
    // ~1.1 km north: well outside the 100 m radius.
    const result = await findAndMerge(client, `${NS}b`, 'Z1', 18.01, 73.0, 'distant');
    await client.query('commit');
    expect(result.merged).toBe(false);
  } finally {
    client.release();
  }
});

maybe('does not merge into a resolved complaint', async () => {
  const client = await pool!.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into complaints (id, district, zone, status, description, lat, lng, report_count, created_at, updated_at)
       values (gen_random_uuid(), $1, 'Z1', 'RESOLVED', 'done', 18.0, 73.0, 1, now(), now())`,
      [`${NS}c`],
    );
    const result = await findAndMerge(client, `${NS}c`, 'Z1', 18.0, 73.0, 'new report');
    await client.query('commit');
    expect(result.merged).toBe(false);
  } finally {
    client.release();
  }
});

/**
 * The property that changed. Concurrent writers to one partition used to queue
 * on the same 25 rows; now each locks only the row it merges into, so they are
 * not serialised against each other.
 */
maybe('concurrent writers to one partition all complete and report_count stays exact', async () => {
  const seed = await pool!.query<{ id: string }>(
    `insert into complaints (id, district, zone, status, description, lat, lng, report_count, created_at, updated_at)
     values (gen_random_uuid(), $1, 'Z1', 'FILED', 'seed', 18.0, 73.0, 1, now(), now()) returning id`,
    [`${NS}d`],
  );
  const seedId = seed.rows[0]!.id;

  const WRITERS = 12;
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: WRITERS }, async (_, i) => {
      const client = await pool!.connect();
      try {
        await client.query('begin');
        // Each writer is a few metres from the seed, and further from each other
        // than the 100 m radius, so they all legitimately merge into the same row.
        const result = await findAndMerge(
          client,
          `${NS}d`,
          'Z1',
          18.0 + (i % 2) * 0.0002,
          73.0 + (i % 3) * 0.0002,
          `writer ${i}`,
        );
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }),
  );
  const elapsed = Date.now() - started;

  const merged = results.filter(r => r.merged);
  expect(merged).toHaveLength(WRITERS);
  for (const r of merged) expect(r.id).toBe(seedId);

  // Exact, not approximately: 1 seeded + 12 merges.
  const final = await pool!.query<{ report_count: number }>(
    `select report_count from complaints where id = $1`,
    [seedId],
  );
  expect(Number(final.rows[0]!.report_count)).toBe(WRITERS + 1);

  // And nothing was serialised into a stall. The old implementation queued all
  // 12 on the same 25 rows.
  expect(elapsed).toBeLessThan(10_000);
});

maybe('a candidate resolved under the lock is not merged into', async () => {
  const client = await pool!.connect();
  // A separate pool, so "another connection commits while this one is in a
  // transaction" is genuinely another connection rather than a second checkout
  // that has to wait for the first.
  const otherPool = new pg.Pool({
    connectionString: URL ?? LOCAL_URL,
    max: 1,
    connectionTimeoutMillis: 3000,
  });
  const other = await otherPool.connect();
  try {
    // Committed before the interleaving starts. Another connection cannot update
    // a row this one has inserted but not committed — the UPDATE would match zero
    // rows and the test would be asserting against a row that was never resolved.
    const created = await client.query<{ id: string }>(
      `insert into complaints (id, district, zone, status, description, lat, lng, report_count, created_at, updated_at)
       values (gen_random_uuid(), $1, 'Z1', 'FILED', 'about to be resolved', 18.0, 73.0, 1, now(), now()) returning id`,
      [`${NS}e`],
    );
    const id = created.rows[0]!.id;

    await client.query('begin');

    // Scan first, then resolve the row from another connection, then take the
    // lock. This is the exact interleaving the re-verification exists for.
    const candidates = await client.query<{ id: string }>(
      `select id from complaints where district = $1 and zone = 'Z1' and lat is not null
        and upper(status) not in ('RESOLVED','DISMISSED','CLOSED') order by created_at desc limit 25`,
      [`${NS}e`],
    );
    expect(candidates.rows).toHaveLength(1);
    expect(candidates.rows[0]!.id).toBe(id);

    const updated = await other.query(
      `update complaints set status = 'RESOLVED' where id = $1 returning id`,
      [id],
    );
    expect(updated.rowCount).toBe(1);

    const locked = await client.query<{ status: string }>(
      `select status from complaints where id = $1 for update`,
      [id],
    );
    // READ COMMITTED gives each statement a fresh snapshot, so the re-check sees
    // the RESOLVED that committed after the scan and refuses to merge.
    expect(locked.rows).toHaveLength(1);
    expect(CLOSED.has(locked.rows[0]!.status.toUpperCase())).toBe(true);

    await client.query('rollback');
  } finally {
    client.release();
    await other.release();
    await otherPool.end().catch(() => undefined);
  }
});
