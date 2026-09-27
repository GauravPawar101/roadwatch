/**
 * Reports the schema state of the configured Postgres, and whether it is
 * sufficient for the application to run.
 *
 * Read-only: it inspects the catalog and never writes. Prints no credentials.
 *
 * A managed database starts empty. The compose and k8s stacks get their schema
 * from docker/postgres/init.sql, which only the Postgres *image* runs on first
 * start — so pointing DATABASE_CLOUD_URL at a fresh managed instance gives a
 * database with no tables, and every request fails. This makes that visible
 * instead of leaving it to be discovered as a 500.
 *
 * Usage: npx tsx tools/verify/schema-report.mts
 */
import { readFileSync } from 'node:fs';
import { createPool } from '../../packages/core/src/postgres.js';
import { resolvePostgresEndpoint } from '../../packages/core/src/config/endpoints.js';

function loadEnv(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
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

if (!endpoint.connectionString || endpoint.source === 'unset') {
  console.log('SKIP: no Postgres endpoint configured.');
  process.exit(0);
}

const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });

/** The tables the compose and k8s stacks create, in dependency order. */
const EXPECTED_SCHEMA = readFileSync(
  new URL('../../docker/postgres/init.sql', import.meta.url).pathname,
  'utf8',
);
// Distinct names: a table declared in more than one branch of a conditional
// still occupies one entry in the catalog, so counting declarations would report
// a shortfall on a fully loaded database.
const expected = [
  ...new Set([...EXPECTED_SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map(m => m[1]!)),
];

try {
  const present = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const have = new Set(present.rows.map(r => r.table_name));

  console.log(`database: ${new URL(endpoint.connectionString).hostname}/${endpoint.connectionString.split('/').pop()?.split('?')[0]}`);
  console.log(`expected: ${expected.length} tables in docker/postgres/init.sql`);
  console.log(`present:  ${have.size} tables\n`);

  const missing = expected.filter(t => !have.has(t));
  const extra = [...have].filter(t => !expected.includes(t)).sort();

  if (missing.length > 0) {
    console.log(`MISSING (${missing.length}):`);
    for (const t of missing) console.log(`  ${t}`);
  }
  if (extra.length > 0) {
    console.log(`\npresent but not in init.sql (${extra.length}):`);
    console.log(`  ${extra.join(', ')}`);
  }

  if (missing.length > 0) {
    console.log(
      '\nACTION: apply the schema. The Postgres image runs init.sql only on first\n' +
        '        start of an empty data directory, which is why the on-device stack\n' +
        '        has a schema and a freshly created managed database does not:\n\n' +
        '          psql "$DATABASE_CLOUD_URL" -v ON_ERROR_STOP=1 -f docker/postgres/init.sql\n\n' +
        '        Nothing else creates these tables. It is a CREATE TABLE IF NOT EXISTS\n' +
        '        script, so re-running it is safe against a partially loaded database.',
    );
    process.exitCode = 1;
  } else {
    console.log('\nOK: every table the application needs is present.');
  }
} catch (err) {
  console.log(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
