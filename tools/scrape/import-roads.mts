import { AGRA_BBOX, OSM_ATTRIBUTION, roadNetworkQuery, runOverpass, type Bbox, type OsmWay } from './osm.mjs';
import { catalogId, centroid, mapWay, type CatalogRoad } from './osm-map.mjs';
import { createPool } from '../../packages/core/src/postgres.js';
import { readFileSync } from 'node:fs';

/**
 * Imports the OSM road network for a district into `roads_catalog`.
 *
 * Writes are idempotent by primary key (`osm:way:<id>`), so a re-run updates rows
 * in place rather than duplicating them. That matters because OSM is a live
 * database: the same import run twice must not double the table, and a partial
 * import must be resumable.
 *
 * Raw responses are cached to disk before anything is written. Two reasons: the
 * fetch is the expensive part and re-running the load should not re-fetch, and a
 * cached copy means the mapping can be re-derived later without depending on
 * Overpass still answering for that area.
 *
 * Usage:
 *   npx tsx tools/scrape/import-roads.mts --dry-run
 *   npx tsx tools/scrape/import-roads.mts --count 2000
 *   npx tsx tools/scrape/import-roads.mts           # full import
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

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

const DRY_RUN = has('dry-run');
const LIMIT = Number(arg('count', '0')) || 0;
const SIMPLIFY_M = Number(arg('simplify', '5'));
const MIN_LENGTH_M = Number(arg('min-length', '10'));
const BBOX: Bbox = AGRA_BBOX;

const CACHE = `data/osm/agra-roads-${BBOX.join('_')}.json`;

async function main(): Promise<void> {
  const log = (m: string): void => console.log(m);

  // ── Fetch, or reuse a cache ─────────────────────────────────────────────
  let ways: OsmWay[];
  let provenance: { source: string; timestamp?: string; license: string } = {
    source: 'openstreetmap',
    license: 'ODbL-1.0',
  };

  const cached = await readCache();
  if (cached) {
    ways = cached;
    // The source is openstreetmap whether the bytes came from Overpass or from
    // disk. Recording "openstreetmap (cached)" as the source was wrong twice over:
    // it is not a source, and spreading it over metadata.source broke every
    // downstream query that filtered on the provenance.
    provenance = { ...provenance, fetched_from_cache: true };
    log(`using ${ways.length} cached ways`);
  } else {
    log('fetching road network from Overpass...');
    const result = await runOverpass(roadNetworkQuery(BBOX), {
      onProgress: log,
      // A real contact string is what Overpass asks for. Left as a variable so a
      // deployment sets it rather than shipping a dead address.
      userAgent: process.env.OVERPASS_USER_AGENT ?? 'roadwatch-osm-import/1.0 (set OVERPASS_USER_AGENT)',
    });
    ways = result.elements.filter((e): e is OsmWay => e.type === 'way');
    provenance = { ...provenance, timestamp: result.osm3s?.timestamp_osm_base };
    await writeCache(ways, provenance);
    log(`fetched ${ways.length} ways, cached to ${CACHE}`);
  }

  if (LIMIT > 0 && ways.length > LIMIT) {
    log(`limiting to ${LIMIT} ways for this run`);
    ways = ways.slice(0, LIMIT);
  }

  // ── Map ──────────────────────────────────────────────────────────────────
  const before = Date.now();
  const roads: CatalogRoad[] = [];
  let skippedNotRoad = 0;
  let skippedTooShort = 0;
  let skippedNoGeometry = 0;

  for (const way of ways) {
    if (!way.tags?.highway) {
      skippedNotRoad += 1;
      continue;
    }
    const road = mapWay(way, { simplifyM: SIMPLIFY_M, minLengthM: MIN_LENGTH_M });
    if (!road) {
      // Distinguish the reasons, because "skipped" with no breakdown is how a
      // filter that silently discards a third of the data goes unnoticed.
      if (!way.geometry || way.geometry.length < 2) skippedNoGeometry += 1;
      else skippedTooShort += 1;
      continue;
    }
    roads.push(road);
  }

  const totalNodes = ways.reduce((n, w) => n + (w.geometry?.length ?? 0), 0);
  const keptNodes = roads.reduce((n, r) => n + r.geometry.length, 0);
  const keptKm = roads.reduce((n, r) => n + r.total_length_km, 0);

  log('');
  log('=== mapping ===');
  log(`ways in              : ${ways.length}`);
  log(`roads catalogued     : ${roads.length}`);
  log(`  not a highway      : ${skippedNotRoad}`);
  log(`  too short (<${MIN_LENGTH_M}m)  : ${skippedTooShort}`);
  log(`  no geometry        : ${skippedNoGeometry}`);
  log(`total length         : ${keptKm.toFixed(0)} km`);
  log(`geometry nodes       : ${totalNodes} -> ${keptNodes} (${((keptNodes / Math.max(totalNodes, 1)) * 100).toFixed(1)}% kept)`);
  log(`took                 : ${((Date.now() - before) / 1000).toFixed(1)}s`);

  const byType = new Map<string, number>();
  for (const r of roads) byType.set(r.road_type, (byType.get(r.road_type) ?? 0) + 1);
  log('');
  log('by road type:');
  for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${type.padEnd(14)} ${n}`);
  }

  // The length distribution, so the minimum-length threshold stays reviewable
  // against the data rather than taken on trust. It is also the quickest way to
  // notice a bbox that clipped a region and left a tail of stubs.
  const roadLengths = roads.map(r => r.total_length_km).sort((a, b) => a - b);
  const at = (p: number): number =>
    roadLengths[Math.min(roadLengths.length - 1, Math.floor(roadLengths.length * p))] ?? 0;
  log('');
  log('length distribution (km):');
  for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    log(`  p${String(Math.round(p * 100)).padStart(2)}  ${at(p).toFixed(4)}`);
  }

  const named = roads.filter(r => r.name).length;
  log('');
  log(`named                : ${named} (${((named / Math.max(roads.length, 1)) * 100).toFixed(1)}%)`);
  log(`attribution          : ${OSM_ATTRIBUTION}`);

  if (DRY_RUN) {
    log('');
    log('dry run: nothing written.');
    return;
  }

  // ── Load ─────────────────────────────────────────────────────────────────
  const env = loadEnv(new URL('../../.env', import.meta.url).pathname);
  const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const before2 = await client.query<{ n: number }>(
      `select count(*)::int as n from roads_catalog`,
    );
    log('');
    log('=== loading ===');
    log(`rows before          : ${before2.rows[0]!.n}`);

    // Batched so one statement is not 31,913 parameter pairs, which would exceed
    // the protocol's parameter limit and blow memory on the client.
    const BATCH = 500;
    for (let i = 0; i < roads.length; i += BATCH) {
      const slice = roads.slice(i, i + BATCH);
      const values: string[] = [];
      const params: unknown[] = [];
      for (const r of slice) {
        values.push(
          `($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, ` +
            `$${params.length + 4}, $${params.length + 5}, $${params.length + 6}::jsonb, ` +
            `$${params.length + 7}::jsonb)`,
        );
        params.push(r.id, r.name, DISTRICT_CODE, r.road_type, r.total_length_km,
          JSON.stringify(r.geometry), JSON.stringify({ ...r.metadata, imported_at: new Date().toISOString(), ...provenance }));
      }
      await client.query(
        `insert into roads_catalog (id, name, district_id, road_type, total_length_km, geometry, metadata)
         values ${values.join(', ')}
         on conflict (id) do update set
           name = excluded.name,
           road_type = excluded.road_type,
           total_length_km = excluded.total_length_km,
           geometry = excluded.geometry,
           metadata = excluded.metadata,
           updated_at = now()`,
        params,
      );
      process.stdout.write(`  ${Math.min(i + BATCH, roads.length)}/${roads.length}\r`);
    }

    const after = await client.query<{ n: number }>(
      `select count(*)::int as n from roads_catalog`,
    );
    await client.query('COMMIT');
    log(`rows after           : ${after.rows[0]!.n}`);

    // Prove the data is usable, not merely present.
    const sample = await client.query<{ id: string; name: string | null; road_type: string; km: number }>(
      `select id, name, road_type, total_length_km as km
       from roads_catalog where district_id = $1
       order by total_length_km desc nulls last limit 5`,
      [DISTRICT_CODE],
    );
    log('');
    log('longest roads:');
    for (const r of sample.rows) {
      log(`  ${String(Number(r.km).toFixed(2)).padStart(7)} km  ${r.road_type.padEnd(12)} ${r.name ?? '(unnamed)'}`);
    }

    const centre = roads.length > 0 ? centroid(roads[0]!.geometry) : null;
    if (centre) log(`\nfirst road centroid  : ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(`\nload failed, rolled back: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

/** The district the imported roads are attributed to. */
const DISTRICT_CODE = process.env.SCRAPE_DISTRICT ?? 'AGRA';

async function readCache(): Promise<OsmWay[] | null> {
  try {
    const raw = readFileSync(CACHE, 'utf8');
    return (JSON.parse(raw) as { ways: OsmWay[] }).ways;
  } catch {
    return null;
  }
}

async function writeCache(ways: OsmWay[], provenance: object): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('data/osm', { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ provenance, ways }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export { catalogId };
