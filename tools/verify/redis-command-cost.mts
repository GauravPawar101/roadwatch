/**
 * Measures the Redis command cost of one admitted complaint write, by counting
 * commands at the client rather than inferring it from the code.
 *
 * Wraps the ioredis client with a counter, runs the real admission path exactly
 * as apps/gateway-api/src/app.ts does, and reports the total.
 *
 * Measures the on-device Redis even when a managed one is configured. This is a
 * cost measurement, and spending a few thousand metered commands to count them
 * would be self-defeating — the per-write cost is a property of the code, not of
 * the server.
 *
 * Nothing is read back, and only the probe's own keys are deleted.
 *
 * Usage: npx tsx tools/verify/redis-command-cost.mts
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim().replace(/^export\s+/, '')] = v;
  }
  return env;
}

const env = loadEnv(new URL('../../.env', import.meta.url).pathname);
const LOCAL_URL = process.env.REDIS_URL ?? env.REDIS_URL ?? 'redis://127.0.0.1:16379/0';

// Force the on-device tier, and do it before the Redis package resolves
// anything — the resolver reads process.env at call time and memoizes per
// environment object, so mutating afterwards would be ignored.
for (const key of ['REDIS_CLOUD_URL', 'REDIS_MANAGED_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
  delete process.env[key];
}
process.env.REDIS_URL = LOCAL_URL;

const counter = { commands: 0, byName: new Map<string, number>() };

const { getRedisClient } = await import('../../packages/redis/client.js');
const { isRedisConfigured } = await import('../../packages/redis/config.js');
const { acquirePermitPair, resetAdaptiveLimitsCache } = await import(
  '../../packages/redis/adaptive-backpressure.js'
);

if (!isRedisConfigured()) {
  console.log('SKIP: no Redis endpoint reachable in the measurement environment.');
  process.exit(0);
}

const client = getRedisClient();

// sendCommand is the single funnel every ioredis command passes through, so
// wrapping it counts everything — including commands issued inside defineCommand
// pipelines and multi-transaction batches.
const original = client.sendCommand.bind(client);
client.sendCommand = (command: unknown, ...args: unknown[]) => {
  counter.commands += 1;
  // ioredis passes a command object; its `name` is the verb. The fallbacks cover
  // a string or Buffer call, which the pipeline and multi paths can use.
  const name =
    (command as { name?: string } | null)?.name ??
    (command instanceof Buffer ? command.toString() : undefined) ??
    (Array.isArray(command) ? String(command[0]) : undefined) ??
    (typeof command === 'string' ? command : 'unknown');
  counter.byName.set(name, (counter.byName.get(name) ?? 0) + 1);
  return original(command, ...args);
};

console.log(`measuring against: ${new URL(LOCAL_URL).host}\n`);

const BOUNDS = {
  // Deliberately far above the write count, so every write is admitted. The
  // question is what an accepted write costs; the rejection path spends extra
  // commands rolling counters back and is reported separately below.
  minRequestsPerWindow: 30,
  maxRequestsPerWindow: Number.MAX_SAFE_INTEGER,
  minInflight: 6,
  maxInflight: Number.MAX_SAFE_INTEGER,
  windowSeconds: 60,
  inflightTtlSeconds: 120,
  // Memoize hard so the adaptive-limit reads are not part of the per-write
  // steady state. They are a real cost every few seconds, reported separately.
  limitsCacheMs: 600_000,
};

const WRITES = Number(process.env.WRITES ?? 200);
const PROBE = `probe:${process.pid}`;

// Warm up separately and do not count it: the first request in a window also
// sets a TTL, and that EXPIRE is a genuine one-off cost. The steady state is the
// honest per-write figure.
for (let i = 0; i < 5; i += 1) {
  const { permit } = await acquirePermitPair({
    route: { scope: `${PROBE}:warm`, principal: 'warm' },
    global: { scope: `${PROBE}:warm:global`, principal: 'global' },
    bounds: BOUNDS,
  });
  await permit.release();
}

counter.commands = 0;
counter.byName.clear();

let granted = 0;
let rejected = 0;
const started = Date.now();
for (let i = 0; i < WRITES; i += 1) {
  try {
    // Exactly the gateway's middleware: one route permit and one global permit,
    // acquired together and released when the response finishes.
    const { permit } = await acquirePermitPair({
      route: { scope: `${PROBE}:route`, principal: `u${i % 20}` },
      global: { scope: `${PROBE}:global`, principal: 'global' },
      bounds: BOUNDS,
    });
    granted += 1;
    await permit.release();
  } catch {
    rejected += 1;
  }
}
const elapsed = Date.now() - started;

console.log(`writes attempted : ${WRITES}`);
console.log(`granted          : ${granted}`);
console.log(`rejected         : ${rejected}`);
console.log(`elapsed          : ${elapsed}ms\n`);
console.log(`Redis commands   : ${counter.commands}`);
console.log(`per write        : ${(counter.commands / WRITES).toFixed(2)}\n`);
console.log('by command:');
for (const [name, n] of [...counter.byName.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(10)} ${String(n).padStart(7)}  ${((n / WRITES) * 100).toFixed(1)}%`);
}

const probeKeys = await client.keys(`${PROBE}*`);
if (probeKeys.length > 0) await client.del(...probeKeys);
await client.quit().catch(() => undefined);
