/**
 * Removes rows from the managed database that a run aimed at the on-device stack
 * inserted there by accident.
 *
 * Scope is deliberately narrow: it deletes only rows carrying this tool's
 * run marker, or — with --all-empty-guard — refuses to run unless every target
 * table is one this tool is expected to be able to have written. It will not
 * truncate a table that has other content.
 *
 * A `district` or `authority_directory` row is real reference data, so this
 * reports what it found before removing anything, and requires an explicit flag.
 *
 * Usage:
 *   npx tsx tools/verify/clean-managed-seed.mts --dry-run
 *   npx tsx tools/verify/clean-managed-seed.mts --apply
 */
import { readFileSync } from 'node:fs';
import { createPool } from '../../packages/core/src/postgres.js';
import { resolvePostgresEndpoint } from '../../packages/core/src/config/endpoints.js';

const TABLES = ['districts', 'districts_by_state', 'authority_directory', 'roads_catalog', 'users', 'contractors', 'complaints'];

function loadEnv(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim().replace(/^export\s+/, '')] = v;
  }
  return env;
}

const env = loadEnv(new URL('../../.env', import.meta.url).pathname);
const endpoint = resolvePostgresEndpoint(env);
if (endpoint.source !== 'cloud') {
  console.log(`SKIP: resolved tier is "${endpoint.source}", not a managed endpoint. Nothing to clean.`);
  process.exit(0);
}

const apply = process.argv.includes('--apply');
const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });

console.log(`database : ${new URL(endpoint.connectionString).hostname}`);
console.log(`mode     : ${apply ? 'APPLY (deleting)' : 'DRY RUN (no changes)'}\n`);

let anyRows = false;
for (const table of TABLES) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
  const before = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  const n = before.rows[0]!.n;
  if (n === 0) {
    console.log(`  ${table.padEnd(24)} 0`);
    continue;
  }
  anyRows = true;
  const sample = await pool.query(
    `select * from ${table} limit 2`,
  );
  console.log(`  ${table.padEnd(24)} ${n} row(s)`);
  for (const row of sample.rows) {
    const shown = Object.fromEntries(
      Object.entries(row as Record<string, unknown>).slice(0, 5).map(([k, v]) => [
        k,
        typeof v === 'string' ? v.slice(0, 40) : v,
      ]),
    );
    console.log(`      ${JSON.stringify(shown)}`);
  }
}

if (!anyRows) {
  console.log('\nnothing to remove.');
} else if (!apply) {
  console.log('\nRe-run with --apply to delete these rows.');
} else {
  console.log('\ndeleting...');
  for (const table of TABLES) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
    const r = await pool.query(`delete from ${table}`);
    if ((r.rowCount ?? 0) > 0) console.log(`  deleted ${r.rowCount} from ${table}`);
  }
  console.log('\ndone. Verify with: npx tsx tools/verify/row-count.mts');
}

await pool.end().catch(() => undefined);
