/**
 * Counts rows in the configured database without modifying anything.
 *
 * Used to confirm that a seeding or profiling run went to the intended database
 * and not to the other one. A seeding run aimed at the on-device stack that
 * silently targeted the managed instance would be a real problem, and the only
 * way to know is to look.
 *
 * Usage: npx tsx tools/verify/row-count.mts [table ...]
 */
import { createPool } from '../../packages/core/src/postgres.js';
import { resolvePostgresEndpoint } from '../../packages/core/src/config/endpoints.js';
import { readFileSync } from 'node:fs';

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

const env = loadEnv(new URL('../../.env', import.meta.url).pathname);
const endpoint = resolvePostgresEndpoint(env);
if (!endpoint.connectionString) {
  console.log('SKIP: no Postgres endpoint configured.');
  process.exit(0);
}

const TABLES = [
  'complaints',
  'districts',
  'users',
  'contractors',
  'authority_directory',
  'complaint_comments',
  'road_assignments',
  'complaint_event_outbox',
  'api_idempotency_keys',
];

const requested = process.argv.slice(2);
const tables = requested.length > 0 ? requested : TABLES;

console.log(
  `database : ${new URL(endpoint.connectionString).hostname}` +
    `  tier=${endpoint.source}  database=${endpoint.connectionString.split('/').pop()?.split('?')[0]}`,
);

const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });
try {
  for (const table of tables) {
    // Table names are not parameterisable, so they are checked against a fixed
    // allow-list pattern rather than interpolated blindly.
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      console.log(`  ${table.padEnd(26)} SKIP (not a plain table name)`);
      continue;
    }
    const r = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    console.log(`  ${table.padEnd(26)} ${r.rows[0]!.n}`);
  }
} catch (err) {
  console.log(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
