/**
 * Live proof that a managed endpoint wins over the in-cluster one.
 *
 * Unit tests can only assert which URL string was chosen. This goes further:
 * it drives the real resolver, the real `pg` pool and a real Redis client, then
 * asks each *actual server* which one received the write. If precedence were
 * broken, the key/row would appear on the local instance instead.
 *
 * Usage: tsx packages/core/src/cloud-precedence.probe.ts
 */
import net from 'node:net';
import { createPool } from './postgres.js';
import { resolveRedisEndpoint } from './config/endpoints.js';
import { getRedisConfig } from '../../redis/config.js';

/**
 * Minimal RESP client. Deliberately hand-rolled rather than using ioredis:
 * ioredis is not a dependency of this package, and speaking the protocol
 * directly makes it unambiguous that the probe observes a real network write
 * rather than a client-library artefact.
 */
function redisCommand(host: string, port: number, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const payload = `*${args.length}\r\n${args.map(a => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`;
    let buffer = '';
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('redis probe timed out'));
    });
    socket.on('connect', () => socket.write(payload));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      // Wait for a complete RESP reply: a simple string (+), error (-), or
      // bulk string ($) terminated by \r\n.
      const type = buffer[0];
      if (type === '+' || type === '-' || type === ':') return finish(buffer.slice(1).trim());
      if (type === '$') {
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const length = Number(buffer.slice(1, end));
        // `$-1` is the nil bulk string, returned by GET for a missing key. It
        // is a complete reply with no payload, not a truncated one.
        if (length === -1) return finish('');
        if (buffer.length < end + 2 + length + 2) return;
        return finish(buffer.slice(end + 2, end + 2 + length));
      }
      if (type === '*') {
        // Nil array, e.g. from an empty EXEC/DISCARD.
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        if (Number(buffer.slice(1, end)) === -1) return finish('');
        return;
      }
    });
    socket.on('error', reject);
    function finish(value: string) {
      socket.end();
      resolve(value);
    }
  });
}

const LOCAL_PG = 'postgresql://postgres:postgres@127.0.0.1:16432/roadwatch';
const MANAGED_PG = 'postgresql://postgres:postgres@127.0.0.1:15434/roadwatch';
const LOCAL_REDIS = 'redis://127.0.0.1:16379/0';
const MANAGED_REDIS = 'redis://127.0.0.1:16380/0';

// Both tiers are set, exactly as they would be in a Kubernetes pod where the
// base manifests always populate the in-cluster values.
const env = {
  DATABASE_URL: LOCAL_PG,
  DATABASE_CLOUD_URL: MANAGED_PG,
  REDIS_URL: LOCAL_REDIS,
  REDIS_CLOUD_URL: MANAGED_REDIS,
} as NodeJS.ProcessEnv;

const results: Array<{ check: string; expected: string; actual: string; pass: boolean }> = [];
function record(check: string, expected: string, actual: string) {
  results.push({ check, expected, actual, pass: expected === actual });
}

// ── Postgres ────────────────────────────────────────────────────────────────
const pool = createPool(env);
record(
  'pool dials the managed database',
  MANAGED_PG,
  String(pool.options.connectionString),
);

await pool.query('DROP TABLE IF EXISTS cloud_precedence_probe');
await pool.query('CREATE TABLE cloud_precedence_probe (id int primary key, note text)');
await pool.query('INSERT INTO cloud_precedence_probe VALUES (1, $1)', ['written-via-pool']);

// ── Redis ───────────────────────────────────────────────────────────────────
const resolved = resolveRedisEndpoint(env);
record('resolver picks the cloud tier', 'cloud', resolved.source);
record('resolver returns the managed URL', MANAGED_REDIS, resolved.url);

const cfg = getRedisConfig(env);
record('redis package agrees with the resolver', MANAGED_REDIS, cfg.url);

const setReply = await redisCommand('127.0.0.1', 16380, 'SET', 'cloud-precedence-probe', 'written-via-resolver');
record('SET accepted by the managed redis', 'OK', setReply);

// ── Ask each real server where the data landed ──────────────────────────────
async function pgHasRow(port: number): Promise<boolean> {
  const probe = createPool({
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/roadwatch`,
  } as NodeJS.ProcessEnv);
  try {
    const r = await probe.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='cloud_precedence_probe'",
    );
    return r.rows[0].n > 0;
  } finally {
    await probe.end();
  }
}

record('managed database actually received the write', true, await pgHasRow(15434));
record('in-cluster database did NOT receive the write', false, await pgHasRow(16432));

async function redisHasKey(port: number): Promise<boolean> {
  const value = await redisCommand('127.0.0.1', port, 'GET', 'cloud-precedence-probe');
  return value === 'written-via-resolver';
}

record('managed redis actually received the write', true, await redisHasKey(16380));
record('in-cluster redis did NOT receive the write', false, await redisHasKey(16379));

// ── The reverse must also hold: with no managed value, fall back in-cluster ──
// A resolver that always preferred "cloud" would pass every check above while
// making the local stack unusable, so the fallback direction is verified too.
const localOnlyEnv = { DATABASE_URL: LOCAL_PG, REDIS_URL: LOCAL_REDIS } as NodeJS.ProcessEnv;
record('without a managed value, postgres falls back in-cluster', LOCAL_PG, createPool(localOnlyEnv).options.connectionString as string);
record('without a managed value, redis falls back in-cluster', LOCAL_REDIS, resolveRedisEndpoint(localOnlyEnv).url);
record('resolver labels the fallback as explicit', 'explicit', resolveRedisEndpoint(localOnlyEnv).source);

await pool.end();
await redisCommand('127.0.0.1', 16380, 'DEL', 'cloud-precedence-probe').catch(() => {});

console.log('');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}`);
  if (!r.pass) console.log(`        expected: ${r.expected}\n        actual:   ${r.actual}`);
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
