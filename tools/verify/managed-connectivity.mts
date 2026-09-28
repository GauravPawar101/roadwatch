/**
 * Live connectivity probe for the configured managed endpoints.
 *
 * Prints no secret values: hosts are shown, credentials never are. Each check
 * is independent and every outcome is reported, so one unreachable provider does
 * not hide the state of the others.
 *
 * Postgres is checked through the application's own pool construction, so a
 * pass means the services can actually connect rather than merely that the host
 * responds to a socket. All queries are read-only.
 *
 * Usage: npx tsx tools/verify/managed-connectivity.mts
 */
import { readFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import {
  describeEndpoints,
  describeManagedEndpointGaps,
  formatManagedEndpointGaps,
  resolveKafkaEndpoint,
  resolvePostgresEndpoint,
  resolveRedisEndpoint,
} from '../../packages/core/src/config/endpoints.js';
import { createPool } from '../../packages/core/src/postgres.js';

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

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';
const WARN = 'WARN';

const results: Array<{ name: string; status: string; detail: string }> = [];
const record = (name: string, status: string, detail: string): void => {
  results.push({ name, status, detail });
};

function tlsProbe(host: string, port: number, timeoutMs = 10_000): Promise<string | undefined> {
  return new Promise(resolve => {
    const socket = tlsConnect({ host, port, servername: host, timeout: timeoutMs });
    const done = (detail?: string) => {
      socket.destroy();
      resolve(detail);
    };
    socket.once('secureConnect', () =>
      done(
        socket.authorized
          ? undefined
          : `handshake ok but certificate unverified (${socket.authorizationError})`,
      ),
    );
    socket.once('timeout', () => done(`timed out after ${timeoutMs}ms`));
    socket.once('error', err => done(err.message));
  });
}

function tcpProbe(host: string, port: number, timeoutMs = 10_000): Promise<string | undefined> {
  return new Promise(resolve => {
    const socket = netConnect({ host, port, timeout: timeoutMs });
    const done = (detail?: string) => {
      socket.destroy();
      resolve(detail);
    };
    socket.once('connect', () => done());
    socket.once('timeout', () => done(`timed out after ${timeoutMs}ms`));
    socket.once('error', err => done(err.message));
  });
}

console.log('=== Resolved endpoints ===');
console.log(`  ${describeEndpoints(env)}\n`);

// ── Postgres ───────────────────────────────────────────────────────────────
// Goes through the real pool so the application's TLS handling is exercised.
// A provider presenting a private CA is expected and is reported as a warning
// rather than a failure: the connection is encrypted, which is what the
// application requires, and `sslmode=verify-full` is left for the operator to
// opt into once a CA is installed.
const pg = resolvePostgresEndpoint(env);
if (!pg.connectionString || pg.source === 'unset') {
  record('postgres', SKIP, `no endpoint configured (tier: ${pg.source})`);
} else {
  const host = new URL(pg.connectionString).hostname;
  const pool = createPool(env, { max: 1, connectionTimeoutMillis: 15_000 });
  try {
    await pool.query('select 1');
    const ssl = await pool.query<{ ssl: boolean; version: string }>(
      'select ssl, version from pg_stat_ssl where pid = pg_backend_pid()',
    );
    const row = ssl.rows[0];
    if (!row?.ssl) {
      record('postgres', FAIL, `${host} connected but the session is NOT encrypted`);
    } else {
      const tables = await pool.query<{ n: number }>(
        `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
      );
      record(
        'postgres',
        PASS,
        `${host} ${row.version} encrypted, ${tables.rows[0]!.n} public tables`,
      );
    }
  } catch (err) {
    record('postgres', FAIL, `${host} — ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// ── Redis ──────────────────────────────────────────────────────────────────
const redis = resolveRedisEndpoint(env);
if (!redis.url) {
  record('redis', SKIP, 'not configured');
} else {
  const parsed = new URL(redis.url);
  const port = Number(parsed.port || 6379);
  const problem = redis.tls ? await tlsProbe(parsed.hostname, port) : await tcpProbe(parsed.hostname, port);
  if (!problem) {
    record('redis', PASS, `${parsed.hostname}:${port} reachable (${redis.tls ? 'tls' : 'plaintext'})`);
  } else if (redis.tls && /certificate|self-signed|unable to verify/i.test(problem)) {
    // A managed cache is reached over TLS; a private CA is a warning, not an
    // outage, and ioredis is configured the same way.
    record('redis', WARN, `${parsed.hostname}:${port} — ${problem}`);
  } else {
    record('redis', FAIL, `${parsed.hostname}:${port} — ${problem}`);
  }
}

// ── Kafka ──────────────────────────────────────────────────────────────────
const tlsProblems = describeManagedEndpointGaps(env).filter(g => g.problem);
for (const cluster of ['events', 'hlf'] as const) {
  const { brokers, source } = resolveKafkaEndpoint(cluster, env);
  const contradiction = tlsProblems.find(g => g.component === `kafka.${cluster}`);
  if (contradiction) {
    record(`kafka.${cluster}`, FAIL, contradiction.problem!);
    continue;
  }
  if (brokers.length === 0) {
    record(`kafka.${cluster}`, SKIP, 'no brokers configured');
    continue;
  }
  const target = brokers[0]!;
  const host = target.replace(/:\d+$/, '');
  if (/^(localhost|127\.|0\.0\.0\.0|::1)$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    record(`kafka.${cluster}`, SKIP, `on-device broker ${target} (tier: ${source})`);
    continue;
  }
  const port = Number(target.split(':').pop()) || 9094;
  const problem = await tlsProbe(host, port);
  record(
    `kafka.${cluster}`,
    problem ? FAIL : PASS,
    problem ? `${target} — ${problem}` : `${target} reachable (tls)`,
  );
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log('=== Connectivity ===');
for (const r of results) {
  console.log(`  [${r.status}] ${r.name.padEnd(16)} ${r.detail}`);
}

const gaps = describeManagedEndpointGaps(env);
const onDevice = gaps.filter(g => !g.problem);
const broken = gaps.filter(g => g.problem);
if (onDevice.length > 0) {
  console.log(`\n  [${SKIP}] on-device         ${formatManagedEndpointGaps(onDevice)}`);
}
if (broken.length > 0) {
  console.log(`\n  [${FAIL}] configuration     ${formatManagedEndpointGaps(broken)}`);
}

const failed = results.filter(r => r.status === FAIL).length;
const warned = results.filter(r => r.status === WARN).length;
const passed = results.filter(r => r.status === PASS).length;
const skipped = results.filter(r => r.status === SKIP).length;

console.log(
  `\n${failed === 0 && broken.length === 0 ? 'OK' : 'PROBLEMS'}: ` +
    `${passed} passed, ${failed} failed, ${warned} warnings, ${skipped} skipped`,
);
process.exitCode = failed === 0 && broken.length === 0 ? 0 : 1;
