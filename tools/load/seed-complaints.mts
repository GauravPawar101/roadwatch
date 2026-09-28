/**
 * Loads complaints directly, for profiling and capacity runs.
 *
 * The demo seed script creates a full world — users, contractors, karma, road
 * assignments — and it stops partway through on this host without reporting an
 * error. Profiling the gateway only needs enough rows for a paginated read to
 * return a full page and for the dedupe query to have candidates to consider, so
 * this inserts exactly that and nothing else.
 *
 * Inserts a fixed, idempotent set: re-running replaces the same row ids rather
 * than duplicating them, so the row count stays stable across runs and a
 * before/after comparison stays valid.
 *
 * Usage: npx tsx tools/load/seed-complaints.mts [--count 5000] [--db local|configured]
 */
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

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const COUNT = Number(arg('count', '5000'));
const which = arg('db', 'local');

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:15433/roadwatch';

const env = loadEnv(new URL('../../.env', import.meta.url).pathname);

let connectionString = LOCAL_URL;
let label = 'on-device (127.0.0.1:15433)';
if (which === 'configured') {
  const { resolvePostgresEndpoint } = await import('../../packages/core/src/config/endpoints.js');
  const endpoint = resolvePostgresEndpoint(env);
  if (!endpoint.connectionString) {
    console.log('no configured Postgres endpoint');
    process.exit(1);
  }
  connectionString = endpoint.connectionString;
  label = `configured (${new URL(connectionString).hostname}, tier=${endpoint.source})`;
}

const { createPool } = await import('../../packages/core/src/postgres.js');
const pool = createPool(
  which === 'configured' ? env : { ...env, ...blankManaged() },
  { max: 1, connectionTimeoutMillis: 15_000 },
);

function blankManaged(): NodeJS.ProcessEnv {
  // See /tmp/opencode/local-stack.sh: empty, not unset, so dotenv cannot refill
  // them from .env and the cloud tier cannot win on precedence.
  return {
    DATABASE_CLOUD_URL: '',
    POSTGRES_CLOUD_URL: '',
    REDIS_CLOUD_URL: '',
    REDIS_MANAGED_URL: '',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    DATABASE_URL: LOCAL_URL,
  };
}

console.log(`target : ${label}`);
console.log(`rows   : ${COUNT}\n`);

const before = await pool.query<{ n: number }>(
  `select count(*)::int as n from complaints where description like '[load] %'`,
);
console.log(`existing load rows: ${before.rows[0]!.n}`);

// One statement, many rows. Inserting 5000 rows in a loop would spend the time
// being measured rather than preparing for the measurement.
const COLUMN_COUNT = 10;
const BATCH = 500;

for (let offset = 0; offset < COUNT; offset += BATCH) {
  const size = Math.min(BATCH, COUNT - offset);
  const rows: unknown[][] = [];
  for (let i = 0; i < size; i += 1) {
    const n = offset + i;
    rows.push([
      // Deterministic uuid from the index, so a re-run replaces rather than
      // duplicates. Shaped as a uuid because the column is uuid.
      `00000000-0000-4000-8000-${String(n % 100000000).padStart(12, '0')}`,
      `LOAD${n % 40}`,                      // 40 districts: enough partitions
      `Z${n % 12}`,                         // 12 zones each
      ['FILED', 'IN_PROGRESS', 'ASSIGNED', 'ESCALATED', 'RESOLVED'][n % 5],
      `[load] row ${n} — fixture for the paginated complaint list read path`,
      18.0 + (n % 2000) * 0.002,
      73.0 + (n % 2000) * 0.002,
      1 + (n % 4),
      // A deterministic age, so `ORDER BY created_at DESC LIMIT 20` is stable
      // between runs and a before/after comparison stays valid.
      `${(COUNT - n) % 50000} minutes`,
      null,                                // created_at: filled by SQL
    ]);
  }

  // One statement per batch. Inserting 5000 rows in a loop would spend the
  // preparation time being measured.
  let p = 1;
  const placeholders = (row: unknown[]): string =>
    `(${row
      .map((_value, col) => {
        if (col === COLUMN_COUNT - 1) return 'now()';
        if (col === COLUMN_COUNT - 2) return `now() - ($${p++} || ' minutes')::interval`;
        return `$${p++}`;
      })
      .join(', ')})`;

  await pool.query(
    `insert into complaints
       (id, district, zone, status, description, lat, lng, report_count, created_at, updated_at)
     values ${rows.map(placeholders).join(', ')}
     on conflict (id) do update set
       report_count = excluded.report_count,
       updated_at = excluded.updated_at`,
    rows.flatMap(row => row.slice(0, COLUMN_COUNT - 1)),
  );
  process.stdout.write(`  inserted ${Math.min(offset + BATCH, COUNT)}/${COUNT}\r`);
}

const after = await pool.query<{ n: number }>(
  `select count(*)::int as n from complaints where description like '[load] %'`,
);
const total = await pool.query<{ n: number }>(`select count(*)::int as n from complaints`);
console.log(`\n\nload rows   : ${after.rows[0]!.n}`);
console.log(`total rows  : ${total.rows[0]!.n}`);

const byStatus = await pool.query<{ status: string; n: number }>(
  `select status, count(*)::int as n from complaints group by status order by n desc`,
);
console.log(`status mix  : ${byStatus.rows.map(r => `${r.status}=${r.n}`).join(' ')}`);

await pool.end().catch(() => undefined);
