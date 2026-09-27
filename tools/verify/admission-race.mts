/**
 * Concurrency proof for the admission script.
 *
 * Fires far more simultaneous admissions than the inflight cap allows and
 * reports how many were admitted and what the counter actually reached. The
 * counter is sampled while the storm is in flight, which is the only way to see
 * the peak: reading it afterwards would show zero, because every admitted permit
 * was released.
 *
 * The previous implementation issued INCR, check, INCR, check as separate
 * commands, so two requests could both read `maxInflight - 1` and both proceed.
 * This is the measurement that distinguishes the two.
 *
 * Usage: npx tsx tools/verify/admission-race.mts
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
for (const key of ['REDIS_CLOUD_URL', 'REDIS_MANAGED_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
  delete process.env[key];
}
process.env.REDIS_URL = process.env.REDIS_URL ?? env.REDIS_URL ?? 'redis://127.0.0.1:16379/0';

const { acquireAdmission, permitKeys } = await import('../../packages/redis/admission.js');
const { getRedisClient } = await import('../../packages/redis/client.js');

const redis = getRedisClient();
const PROBE = `race:${process.pid}`;
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT ?? 8);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 200);

const permit = (scope: string, principal: string, maxInflight: number) => ({
  scope,
  principal,
  maxRequestsPerWindow: 1_000_000,
  windowSeconds: 60,
  maxInflight,
  inflightTtlSeconds: 120,
});

const keys = permitKeys(permit(`${PROBE}:route`, 'u1', MAX_INFLIGHT));
const stale = await redis.keys(`${PROBE}*`);
if (stale.length > 0) await redis.del(...stale);

console.log(`maxInflight   : ${MAX_INFLIGHT}`);
console.log(`concurrency   : ${CONCURRENCY} simultaneous admissions\n`);

let peak = 0;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const n = Number((await redis.get(keys.inflightKey)) ?? '0');
    if (n > peak) peak = n;
    // Yield between samples so the loop does not starve the event loop; the
    // point is to catch the peak, not to count every state it passes through.
    await new Promise(resolve => setImmediate(resolve));
  }
})();

const results = await Promise.all(
  Array.from({ length: CONCURRENCY }, () =>
    acquireAdmission(redis, [
      permit(`${PROBE}:route`, 'u1', MAX_INFLIGHT),
      permit(`${PROBE}:global`, 'global', MAX_INFLIGHT),
    ]),
  ),
);
sampling = false;
await sampler;

const admitted = results.filter(r => r.outcome.admitted);
const byReason = new Map<string, number>();
for (const r of results) {
  const key = r.outcome.admitted ? 'admitted' : (r.outcome.rejection ?? 'unknown');
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}

console.log('outcomes:');
for (const [reason, n] of [...byReason.entries()].sort()) {
  console.log(`  ${reason.padEnd(10)} ${String(n).padStart(5)}`);
}
console.log(`\npeak inflight observed : ${peak}`);
console.log(`admitted               : ${admitted.length}`);

// Release, then confirm the counter returns to exactly zero: a leak here would
// silently reduce capacity for the life of the process.
await Promise.all(admitted.map(r => r.release()));
const after = Number((await redis.get(keys.inflightKey)) ?? '0');
console.log(`after release          : ${after}`);

const overCap = peak > MAX_INFLIGHT || admitted.length > MAX_INFLIGHT;
const leaked = after !== 0;

const cleanup = await redis.keys(`${PROBE}*`);
if (cleanup.length > 0) await redis.del(...cleanup);

if (overCap) {
  console.log(`\nFAIL  the cap was exceeded: ${peak} concurrent with a limit of ${MAX_INFLIGHT}`);
  process.exitCode = 1;
} else if (leaked) {
  console.log(`\nFAIL  ${after} permits leaked; capacity would be lost permanently`);
  process.exitCode = 1;
} else {
  console.log(`\nOK: never more than ${MAX_INFLIGHT} concurrent, and nothing leaked.`);
}
await redis.quit().catch(() => undefined);
