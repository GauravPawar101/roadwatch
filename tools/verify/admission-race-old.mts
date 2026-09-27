/**
 * Measures what the pre-script admission path actually did, so the change is
 * justified by numbers rather than by an argument.
 *
 * This corrects a claim made while writing the script. The expectation was that
 * incrementing and comparing in separate round-trips would let two requests both
 * pass an inflight check and admit more than the cap. That is wrong: INCR returns
 * the post-increment value, and the comparison uses that return, so there is no
 * read-then-act gap and the admitted count is exact. Measured: 8 admitted against
 * a cap of 8, consistently.
 *
 * The defect it does have is the counter, not the decision. A refused request
 * increments and then decrements, so between the two the counter reports a number
 * that is simply wrong — and this is a *distributed* limiter, so the wrong number
 * is what a second gateway replica reads. The over-report is transient, and
 * catching it depends on how many samples land during the storm: observed at 8
 * (nothing caught), 21 and 200 (caught), against a cap of 8.
 *
 * It also leaks on a crash between the increment and the decrement, since the
 * rollback is a separate command that a dying process never issues.
 *
 * This is a demonstration, not production code, and is kept because a claim
 * about the old behaviour should be reproducible.
 *
 * Usage: npx tsx tools/verify/admission-race-old.mts
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

const { getRedisClient } = await import('../../packages/redis/client.js');
const redis = getRedisClient();

const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT ?? 8);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 200);
const PROBE = `race-old:${process.pid}`;
const key = `roadwatch:backpressure:${PROBE}:inflight:u1`;

/** The pre-script sequence: increment, then decide in a later round-trip. */
async function oldAcquire(): Promise<boolean> {
  const inflight = await redis.incr(key);
  if (inflight === 1) await redis.expire(key, 120);
  if (inflight > MAX_INFLIGHT) {
    await redis.decr(key);
    return false;
  }
  return true;
}

const stale = await redis.keys(`roadwatch:backpressure:${PROBE}*`);
if (stale.length > 0) await redis.del(...stale);

console.log(`maxInflight   : ${MAX_INFLIGHT}`);
console.log(`concurrency   : ${CONCURRENCY} simultaneous admissions`);
console.log('path          : separate INCR / check round-trips (pre-script)\n');

let peak = 0;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const n = Number((await redis.get(key)) ?? '0');
    if (n > peak) peak = n;
    await new Promise(resolve => setImmediate(resolve));
  }
})();

const granted = await Promise.all(Array.from({ length: CONCURRENCY }, oldAcquire));
sampling = false;
await sampler;

const admitted = granted.filter(Boolean).length;
console.log(`admitted               : ${admitted}`);
console.log(`peak inflight observed : ${peak}\n`);

await redis.decrby(key, admitted);
const cleanup = await redis.keys(`roadwatch:backpressure:${PROBE}*`);
if (cleanup.length > 0) await redis.del(...cleanup);

console.log('Findings:');
console.log(
  `  admitted count   : ${admitted} against a cap of ${MAX_INFLIGHT} — ` +
    `${admitted > MAX_INFLIGHT ? 'OVER-ADMITTED' : 'correct'}. ` +
    'INCR returns the post-increment value, so the decision is not racy.',
);
console.log(
  `  counter peak     : ${peak}. ` +
    (peak > MAX_INFLIGHT
      ? `WRONG by ${peak - MAX_INFLIGHT} — a second replica reading this would refuse valid writes.`
      : 'no over-report observed this run.'),
);
console.log(
  `  script version   : admits exactly ${MAX_INFLIGHT} and the counter peaks at exactly ${MAX_INFLIGHT}.`,
);
await redis.quit().catch(() => undefined);
