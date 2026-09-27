/**
 * Live read-only connectivity probe for the configured Postgres.
 *
 * Uses the *application's* TLS path — resolvePostgresEndpoint plus
 * normaliseSslMode and the same `ssl` option the pools pass — so a pass here
 * means the services can actually connect, not merely that the host is up.
 *
 * Read-only by construction: it issues SELECTs and pg_stat_ssl, never a write.
 * Prints no credential values.
 *
 * Usage: npx tsx packages/core/src/probe-postgres.mts
 */
import { readFileSync } from 'node:fs';
import { createPool } from './postgres.js';
import { resolvePostgresEndpoint, describeEndpoints } from './config/endpoints.js';
import { normaliseSslMode } from './ssl-mode.js';

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

const env = loadEnv(process.env.ENV_FILE ?? '.env');
const endpoint = resolvePostgresEndpoint(env);
const host = endpoint.connectionString
  ? new URL(endpoint.connectionString).hostname
  : '(none)';

console.log(`endpoints: ${describeEndpoints(env)}`);
console.log(`target:    ${host}  tier=${endpoint.source}  ssl=${endpoint.ssl}`);

if (endpoint.source === 'unset' || !endpoint.connectionString) {
  console.log('SKIP: no Postgres endpoint configured.');
  process.exit(0);
}

const asAppWould = normaliseSslMode(endpoint.connectionString, endpoint.ssl);
if (asAppWould !== endpoint.connectionString) {
  console.log('note:     sslmode rewritten for node-postgres (require -> no-verify)');
}

// The pool, built exactly as the services build it, so this exercises the same
// code path rather than a hand-rolled client.
const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });

try {
  const version = await pool.query('select version()');
  console.log(`\nPASS  connected: ${(version.rows[0] as { version: string }).version.split(',')[0]}`);

  const tables = await pool.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  );
  console.log(`      public tables: ${tables.rows[0]!.n}`);

  const identity = await pool.query<{ user: string; db: string }>(
    'select current_user as user, current_database() as db',
  );
  console.log(`      identity: ${identity.rows[0]!.user} @ ${identity.rows[0]!.db}`);

  const ssl = await pool.query<{ ssl: boolean; version: string; cipher: string }>(
    'select ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid()',
  );
  const row = ssl.rows[0];
  console.log(`      TLS: ${row?.ssl ? `${row.version} ${row.cipher}` : 'NOT ENCRYPTED'}`);
  if (!row?.ssl) {
    console.log('\nWARN: the connection is not encrypted. A managed endpoint should refuse plaintext.');
    process.exitCode = 1;
  } else {
    console.log('\nOK: the services can read from the configured database.');
  }
} catch (err) {
  console.log(`\nFAIL  ${err instanceof Error ? err.message : String(err)}`);
  console.log('      The pools in core/postgres.ts, core/postgres-adapter.ts and');
  console.log('      apps/gateway-api/src/postgres.ts all use this same path.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
