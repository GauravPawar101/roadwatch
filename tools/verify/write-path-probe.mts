/**
 * Exercises the application's real complaint-create transaction against the
 * configured Postgres, then removes the row it created.
 *
 * A schema can load cleanly and still be unusable: a managed instance can lack
 * a privilege, a constraint or an extension that the on-device database has,
 * and the only way to find out is to run the write. The gateway's create path is
 * inside a single transaction that touches several tables, so this covers more
 * than a single insert.
 *
 * It writes one clearly-labelled probe row and deletes it in a finally block.
 * Nothing else is touched. Prints no credentials.
 *
 * Usage: npx tsx tools/verify/write-path-probe.mts
 */
import { createPool } from '../../packages/core/src/postgres.js';
import { resolvePostgresEndpoint } from '../../packages/core/src/config/endpoints.js';
import { readFileSync } from 'node:fs';

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

const pool = createPool(env, { max: 2, connectionTimeoutMillis: 15_000 });

// Distinctive so cleanup can be verified, and removable so it is never mistaken
// for real data.
const PROBE_UUID = '00000000-0000-4000-8000-00000000f00d';

// `complaints.district` is a plain text column with no foreign key, so a real
// district is not required — and init.sql seeds no reference rows, so a freshly
// created database has none. The probe supplies its own value rather than
// depending on the seed script having been run.
const DISTRICT = 'probe-district';
console.log(`target:  ${new URL(endpoint.connectionString).hostname}\ndistrict: ${DISTRICT} (probe-local, no FK)\n`);

const client = await pool.connect();
let created = false;

try {
  // One transaction, as the gateway does it: the complaint, the outbox entry and
  // the idempotency claim. A failure in any of them surfaces the privilege,
  // type or constraint problem that a bare insert into one table would miss.
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO complaints (id, district, zone, status, description, lat, lng, report_count, created_at, updated_at)
     VALUES ($1, $2, 'probe-zone', 'open', $3, 12.9716, 77.5946, 1, now(), now())`,
    [PROBE_UUID, DISTRICT, 'roadwatch write-path probe — safe to delete'],
  );
  created = true;
  // Column names are taken from init.sql itself, not from memory: the outbox is
  // keyed by topic/message_key and the idempotency table by (scope,
  // idempotency_key), so a guess here would report a missing column rather than
  // a missing privilege.
  await client.query(
    `INSERT INTO complaint_event_outbox (topic, message_key, payload)
     VALUES ('complaint.created', $1, $2::jsonb)`,
    [PROBE_UUID, JSON.stringify({ probe: true })],
  );
  await client.query(
    `INSERT INTO api_idempotency_keys (scope, idempotency_key, request_hash, response_code)
     VALUES ('probe', $1, 'probe-hash', 200)`,
    [`probe-${PROBE_UUID}`],
  );
  await client.query('COMMIT');
  console.log('PASS  complaint + outbox + idempotency inserted in one transaction');

  const read = await client.query<{ report_count: number; status: string }>(
    'select report_count, status from complaints where id = $1',
    [PROBE_UUID],
  );
  console.log(`      read back: report_count=${read.rows[0]!.report_count} status=${read.rows[0]!.status}`);

  // The dedupe query carries a partial index that the app depends on for
  // latency; confirm the index exists here too, or writes will seq-scan.
  const idx = await client.query<{ indexname: string }>(
    `select indexname from pg_indexes
      where tablename = 'complaints' and indexname like '%dedup%'`,
  );
  console.log(
    `      dedupe index: ${idx.rows.map(r => r.indexname).join(', ') || 'ABSENT — dedupe will seq-scan'}`,
  );

  console.log('\nOK: the write path works against this database.');
} catch (err) {
  console.log(`\nFAIL  ${err instanceof Error ? err.message : String(err)}`);
  const code = (err as { code?: string }).code;
  if (code === '42501') {
    console.log('      42501 is insufficient_privilege: the managed user cannot perform this write.');
    console.log('      Check the grants on the roadwatch schema for the role in DATABASE_CLOUD_URL.');
  }
  process.exitCode = 1;
} finally {
  if (created) {
    // Clean up outside the failed transaction, and only the probe's own rows.
    await client.query('BEGIN').catch(() => undefined);
    await client.query('DELETE FROM complaint_event_outbox WHERE message_key = $1', [PROBE_UUID]).catch(() => undefined);
    await client.query('DELETE FROM api_idempotency_keys WHERE scope = $1 AND idempotency_key = $2', ['probe', `probe-${PROBE_UUID}`]).catch(() => undefined);
    await client.query('DELETE FROM complaints WHERE id = $1', [PROBE_UUID]).catch(() => undefined);
    await client.query('COMMIT').catch(() => undefined);
    const left = await client.query('select count(*)::int as n from complaints where id = $1', [PROBE_UUID]).catch(() => null);
    console.log(`\ncleanup: ${left ? `${left.rows[0]!.n} probe rows remaining` : 'could not verify cleanup'}`);
  }
  client.release();
  await pool.end().catch(() => undefined);
}
