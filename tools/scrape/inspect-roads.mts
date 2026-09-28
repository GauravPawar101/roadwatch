/**
 * Prints a few rows from roads_catalog as stored, for diagnosing an import that
 * wrote something unexpected.
 *
 * Read-only. Usage: npx tsx tools/scrape/inspect-roads.mts [limit]
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    const k = t.slice(0, eq).trim().replace(/^export\s+/, '');
    if (env[k] === undefined) env[k] = v;
  }
  return env;
}

const env = loadEnv(new URL('../../.env', import.meta.url).pathname);
const pool = createPool(env, { max: 1, connectionTimeoutMillis: 30_000 });
const limit = Number(process.argv[2] ?? 3);

try {
  const { resolvePostgresEndpoint } = await import('../../packages/core/src/config/endpoints.js');
  const endpoint = resolvePostgresEndpoint(env);
  console.log(`database: ${endpoint.connectionString ? new URL(endpoint.connectionString).hostname : '?'} (tier=${endpoint.source})`);

  const total = await pool.query<{ n: number }>(`select count(*)::int as n from roads_catalog`);
  console.log(`rows: ${total.rows[0]!.n}\n`);

  const rows = await pool.query<Record<string, unknown>>(
    `select id, name, road_type, district_id, total_length_km,
            jsonb_array_length(geometry) as points,
            metadata->>'source' as source,
            metadata->>'license' as license,
            (geometry->0) as first_point
     from roads_catalog order by total_length_km desc nulls last limit $1`,
    [limit],
  );
  for (const r of rows.rows) {
    console.log(JSON.stringify(r, null, 2));
    console.log('');
  }
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
