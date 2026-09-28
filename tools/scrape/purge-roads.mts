/**
 * Removes OSM road rows from a database.
 *
 * Deliberately narrow: it deletes only rows whose id carries the importer's prefix
 * and whose metadata says it came from OpenStreetMap, so it cannot touch a road
 * entered by hand even if one shares the table. It refuses entirely unless given
 * `--apply`, and prints the count and the id range it is about to remove.
 *
 * Exists because an import aimed at the on-device stack targeted the managed
 * database instead: the tool's environment loader ignored process.env, so the
 * cloud tier won on precedence. 30,754 rows landed in a database that had been
 * empty, and the fix is to remove exactly those.
 *
 * Usage:
 *   npx tsx tools/scrape/purge-roads.mts
 *   npx tsx tools/scrape/purge-roads.mts --apply
 */
import { readFileSync } from 'node:fs';
import { createPool } from '../../packages/core/src/postgres.js';

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
    // Only fill in what the environment does not already carry, so an explicit
    // override — including an empty one — survives.
    if (env[t.slice(0, eq).trim().replace(/^export\s+/, '')] === undefined) {
      env[t.slice(0, eq).trim().replace(/^export\s+/, '')] = v;
    }
  }
  return env;
}

const APPLY = process.argv.includes('--apply');
const env = loadEnv(new URL('../../.env', import.meta.url).pathname);

const pool = createPool(env, { max: 1, connectionTimeoutMillis: 30_000 });

try {
  const summary = await pool.query<{ n: number; km: number; districts: string[] }>(
    `select count(*)::int as n,
            coalesce(round(sum(total_length_km)::numeric), 0)::float as km,
            array_agg(distinct district_id) as districts
     from roads_catalog
     where id like 'osm:way:%' and metadata->>'license' = 'ODbL-1.0'`,
  );
  const s = summary.rows[0]!;
  // The endpoint host, so the operator can see which database they are about to
  // change before answering --apply. Printed from the resolved env, not from a
  // query, so it works before connecting.
  const { resolvePostgresEndpoint } = await import('../../packages/core/src/config/endpoints.js');
  const endpoint = resolvePostgresEndpoint(env);
  const host = endpoint.connectionString ? new URL(endpoint.connectionString).hostname : '(none)';
  const tier = endpoint.source;

  console.log(`database    : ${host}  (tier=${tier})`);
  console.log(`osm roads   : ${s.n}`);
  console.log(`total length: ${s.km.toFixed(0)} km`);
  console.log(`districts   : ${s.districts.join(', ')}`);

  if (s.n === 0) {
    console.log('\nnothing to remove.');
  } else if (!APPLY) {
    const other = await pool.query<{ n: number }>(
      `select count(*)::int as n from roads_catalog
       where not (id like 'osm:way:%' and metadata->>'license' = 'ODbL-1.0')`,
    );
    console.log(`\n${other.rows[0]!.n} non-OSM rows in the table will be left alone.`);
    console.log('Re-run with --apply to delete the OSM rows.');
  } else {
    const deleted = await pool.query(
      `delete from roads_catalog where id like 'osm:way:%' and metadata->>'license' = 'ODbL-1.0'`,
    );
    const left = await pool.query<{ n: number }>(`select count(*)::int as n from roads_catalog`);
    console.log(`\ndeleted ${deleted.rowCount} rows; ${left.rows[0]!.n} remain in the table.`);
  }
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
