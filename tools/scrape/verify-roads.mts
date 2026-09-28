/**
 * Verifies the imported road catalog against the data it came from.
 *
 * A scraper that writes rows is not the same as a scraper that writes *correct*
 * rows, and the failures are silent: a swapped coordinate order, a geometry stored
 * as a string, a length computed on the wrong axis — all of them load cleanly and
 * produce a map that is subtly wrong.
 *
 * Every check here is an assertion about correctness rather than about presence.
 * Read-only.
 *
 * Usage: npx tsx tools/scrape/verify-roads.mts
 */
import { readFileSync } from 'node:fs';
import { createPool } from '../../packages/core/src/postgres.js';

/**
 * Environment for the tools, with **process.env taking precedence**.
 *
 * `process.env` is seeded from process.env rather than starting empty, and the file
 * only fills in keys that are not already set. That ordering is the whole point:
 * the cloud tier has the highest precedence in the resolver, so a tool that ignored
 * process.env would silently target the managed database even when the operator had
 * explicitly blanked the cloud variables to work against the on-device one.
 *
 * This is not hypothetical — it is what put 29,997 scraped roads into the managed
 * database instead of the local one, and what made a verification probe time out
 * against a host it was never meant to touch. Set a variable to an empty string to
 * shadow the file: the resolver treats empty as unset, so the local tier wins.
 */
function loadEnv(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, eq).trim().replace(/^export\s+/, '')] = v;
  }
  return env;
}

// Agra's bounding box, with margin for the roads that clip the edge.
const BBOX = { south: 26.85, west: 77.5, north: 27.35, east: 78.05 };
const DISTRICT = process.env.SCRAPE_DISTRICT ?? 'AGRA';

const env = loadEnv(new URL('../../.env', import.meta.url).pathname);
const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
};

try {
  const totals = await pool.query<{ n: number; km: number; named: number }>(
    `select count(*)::int as n,
            coalesce(round(sum(total_length_km)::numeric), 0)::float as km,
            count(*) filter (where name is not null)::int as named
     from roads_catalog where district_id = $1`,
    [DISTRICT],
  );
  const t = totals.rows[0]!;
  console.log(`\nroads: ${t.n}   total: ${t.km.toFixed(0)} km   named: ${t.named}\n`);

  check('catalog is populated', t.n > 1000, `${t.n} rows`);

  // Every road must carry its licence. This is not bookkeeping: ODbL requires
  // attribution, and a row extracted from this database carries that obligation
  // with it. Losing it makes the derived database non-compliant.
  const unattributed = await pool.query<{ n: number }>(
    `select count(*)::int as n from roads_catalog
     where district_id = $1 and (metadata->>'license' is null or metadata->>'attribution' is null)`,
    [DISTRICT],
  );
  check(
    'every row carries ODbL attribution',
    unattributed.rows[0]!.n === 0,
    `${unattributed.rows[0]!.n} rows without licence/attribution`,
  );

  // A swapped coordinate order is the failure this whole exercise is about: it
  // loads perfectly and puts the entire network in the wrong hemisphere.
  const outside = await pool.query<{ n: number }>(
    `select count(*)::int as n from roads_catalog
     where district_id = $1
       and (
         (geometry->0->>0)::float8 < $2 or (geometry->0->>0)::float8 > $3
         or (geometry->0->>1)::float8 < $4 or (geometry->0->>1)::float8 > $5
       )`,
    [DISTRICT, BBOX.west, BBOX.east, BBOX.south, BBOX.north],
  );
  check(
    'every geometry starts inside the district bbox',
    outside.rows[0]!.n === 0,
    `${outside.rows[0]!.n} rows outside lng ${BBOX.west}-${BBOX.east}, lat ${BBOX.south}-${BBOX.north}`,
  );

  // Geometry must be a real coordinate array, not a string or a nested object.
  const malformed = await pool.query<{ n: number }>(
    `select count(*)::int as n from roads_catalog
     where district_id = $1
       and (jsonb_typeof(geometry) <> 'array' or jsonb_array_length(geometry) < 2)`,
    [DISTRICT],
  );
  check('geometry is an array of at least 2 points', malformed.rows[0]!.n === 0,
    `${malformed.rows[0]!.n} malformed`);

  // The length filter must actually have been applied.
  const tooShort = await pool.query<{ n: number }>(
    `select count(*)::int as n from roads_catalog where district_id = $1 and total_length_km < 0.0099`,
    [DISTRICT],
  );
  check('no roads below the 10m minimum', tooShort.rows[0]!.n === 0,
    `${tooShort.rows[0]!.n} rows under 10m`);

  // A recomputed length from the stored geometry must match the stored length.
  // A recomputed length from the stored geometry must match the stored length.
  // This is the check that catches an axis swap in lengthKm: recomputing with the
  // same function cannot see it, so this recomputes here, independently, from the
  // geometry that is actually in the database.
  const sample = await pool.query<{ id: string; stored: number; geometry: number[][] }>(
    `select id, total_length_km as stored, geometry
     from roads_catalog where district_id = $1
     order by total_length_km desc limit 200`,
    [DISTRICT],
  );
  const mismatches: string[] = [];
  for (const row of sample.rows) {
    // geometry is [[lng, lat], ...] — GeoJSON order, and the thing a swap breaks.
    const computed = haversineKm(row.geometry.map(pt => [pt[0]!, pt[1]!]));
    if (Math.abs(computed - Number(row.stored)) > 0.05) {
      mismatches.push(`${row.id}: stored ${Number(row.stored).toFixed(3)} vs recomputed ${computed.toFixed(3)}`);
    }
  }
  check(
    'stored length matches an independent recomputation',
    mismatches.length === 0,
    mismatches.length === 0
      ? `${sample.rows.length} longest roads verified`
      : `${mismatches.length} mismatched, e.g. ${mismatches[0]}`,
  );
  check(
    'stored length matches an independent recomputation',
    mismatch.rows.length === 0,
    mismatch.rows.length === 0
      ? '300 longest roads verified'
      : `${mismatch.rows.length} mismatched, e.g. ${mismatch.rows[0]!.id} stored ${Number(mismatch.rows[0]!.stored).toFixed(3)} vs recomputed ${Number(mismatch.rows[0]!.recomputed).toFixed(3)}`,
  );

  // A named sample, to confirm the mapping kept names rather than discarding them.
  const named = await pool.query<{ name: string; road_type: string; km: number }>(
    `select name, road_type, total_length_km as km from roads_catalog
     where district_id = $1 and name is not null
     order by total_length_km desc limit 8`,
    [DISTRICT],
  );
  check('named roads are present and plausible', named.rows.length > 0,
    `${t.named} named of ${t.n} (${((t.named / Math.max(t.n, 1)) * 100).toFixed(1)}%)`);

  console.log('longest named roads:');
  for (const r of named.rows) {
    console.log(`  ${String(Number(r.km).toFixed(2)).padStart(7)} km  ${r.road_type.padEnd(11)} ${r.name}`);
  }

  const byType = await pool.query<{ road_type: string; n: number }>(
    `select road_type, count(*)::int as n from roads_catalog where district_id = $1
     group by road_type order by n desc`,
    [DISTRICT],
  );
  console.log('\nby type:');
  for (const r of byType.rows) console.log(`  ${r.road_type.padEnd(14)} ${r.n}`);

  console.log('\nchecks:');
  for (const c of checks) {
    console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name.padEnd(52)} ${c.detail}`);
  }
  const failed = checks.filter(c => !c.ok).length;
  console.log(`\n${failed === 0 ? 'OK' : 'PROBLEMS'}: ${checks.length - failed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
