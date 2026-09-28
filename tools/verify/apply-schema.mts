/**
 * Applies the schema to the configured Postgres, using the application's own
 * connection path so the TLS handling is identical to the services'.
 *
 * Uses `sslmode=no-verify` via normaliseSslMode, because Aiven's private CA is
 * not in the system trust store — see ssl-mode.ts.
 *
 * docker/postgres/init.sql is 55 x CREATE TABLE IF NOT EXISTS with no DROP,
 * TRUNCATE, DELETE or role changes, so this is re-runnable and destroys
 * nothing.
 *
 * Usage: npx tsx tools/verify/apply-schema.mts
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
if (!endpoint.connectionString) {
  console.log('SKIP: no Postgres endpoint configured.');
  process.exit(0);
}

const schemaPath = new URL('../../docker/postgres/init.sql', import.meta.url).pathname;
const schema = readFileSync(schemaPath, 'utf8');
// A table can be declared more than once — embeddings is created once per
// branch of a conditional around the pgvector extension — so the count is of
// distinct names, matching what the catalog will hold.
const expected = [
  ...new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map(m => m[1]!)),
];

/**
 * Reports whether the script can destroy anything, and refuses to guess.
 *
 * The distinction is DROP/TRUNCATE against ADD COLUMN. A blanket scan for the
 * word ALTER is useless here: every migration-shaped script uses ALTER, and in
 * this one all thirteen are `ADD COLUMN IF NOT EXISTS`, which cannot lose data.
 * Only the destructive verbs count.
 */
const destructive = /^\s*(DROP|TRUNCATE)\b/im.test(schema)
  || /ALTER\s+TABLE[^;]*\bDROP\s+(COLUMN|CONSTRAINT)/i.test(schema);
if (destructive) {
  console.log('REFUSING: the schema contains destructive statements. Review it first.');
  process.exit(1);
}

console.log(`target:  ${new URL(endpoint.connectionString).hostname}`);
console.log(`schema:  ${expected.length} tables from docker/postgres/init.sql`);
console.log(
  `safety:  no DROP/TRUNCATE/DROP COLUMN; ` +
    `${(schema.match(/ADD COLUMN IF NOT EXISTS/gi) ?? []).length} additive ALTERs, re-runnable\n`,
);

const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });

try {
  const before = await pool.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  console.log(`before:  ${before.rows[0]!.n} tables\n`);
  console.log('applying...');

  await pool.query(schema);

  const after = await pool.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  console.log(`\nafter:   ${after.rows[0]!.n} tables`);

  // Verify per table rather than trusting the count, so a name that failed
  // silently is named.
  const present = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const have = new Set(present.rows.map(r => r.table_name));
  const missing = expected.filter(t => !have.has(t));
  if (missing.length > 0) {
    console.log(`\nMISSING (${missing.length}): ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nOK: all ${expected.length} tables created.`);

    // A table can exist and still be unusable, so exercise the paths the
    // application depends on rather than stopping at catalog presence.
    const probe = await pool.query<{ complaints: number; users: number }>(
      'select (select count(*) from complaints)::int as complaints, (select count(*) from users)::int as users',
    );
    console.log(`      readable: complaints=${probe.rows[0]!.complaints} users=${probe.rows[0]!.users}`);

    const ext = await pool.query<{ extname: string }>(
      `select extname from pg_extension where extname in ('pgcrypto','vector')`,
    );
    console.log(`      extensions: ${ext.rows.map(r => r.extname).join(', ') || 'none'}`);
  }
} catch (err) {
  console.log(`\nFAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
