/**
 * Load generator for profiling and capacity measurement.
 *
 * A small deliberate choice: k6 runs in a container here, and in the earlier
 * capacity work the generator consumed more CPU than the entire data plane. That
 * makes the gateway's own CPU impossible to attribute. This generator is a single
 * Node process with a fixed number of in-flight requests, so the load it applies
 * is known exactly and its own overhead is visible and small.
 *
 * It is a closed loop, not an arrival-rate model: it keeps CONCURRENCY requests
 * in flight and reports the latency the system actually produced at that
 * concurrency. That is the number needed for a per-request CPU cost.
 *
 *   npx tsx tools/load/probe.ts --mode read  --concurrency 16 --seconds 30
 *   npx tsx tools/load/probe.ts --mode write --concurrency 8  --seconds 30
 *
 * Reports throughput, latency percentiles and the status-code mix. It does not
 * print response bodies.
 */
import crypto from 'node:crypto';

interface Options {
  mode: 'read' | 'write';
  concurrency: number;
  seconds: number;
  target: string;
  accessSecret: string;
  spreadZones: number;
  warmupSeconds: number;
}

function parseArgs(argv: string[]): Options {
  const arg = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1]! : fallback;
  };
  return {
    mode: arg('mode', 'read') as Options['mode'],
    concurrency: Number(arg('concurrency', '16')),
    seconds: Number(arg('seconds', '30')),
    target: arg('target', 'http://127.0.0.1:3100'),
    accessSecret: arg(
      'secret',
      process.env.ACCESS_SECRET ??
        process.env.JWT_SECRET ??
        'local_development_cryptographic_secret',
    ),
    spreadZones: Number(arg('spread-zones', '0')),
    warmupSeconds: Number(arg('warmup', '5')),
  };
}

const b64url = (v: string | Buffer): string =>
  Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function buildToken(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      sub: '00000000-0000-4000-8000-0000000000ff',
      role: 'CE',
      districts: ['ALL'],
      zones: ['ALL'],
      iat: now,
      exp: now + 60 * 60 * 12,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

const options = parseArgs(process.argv.slice(2));
const token = buildToken(options.accessSecret);
const AUTH = { Authorization: `Bearer ${token}` };

const statuses = new Map<number, number>();
const latencies: number[] = [];
let completed = 0;
let seq = 0;

const RUN_ID = `probe-${Date.now()}`;

async function oneRequest(): Promise<{ ms: number; status: number }> {
  const started = performance.now();
  try {
    if (options.mode === 'read') {
      const res = await fetch(`${options.target}/authority/complaints?limit=20`, {
        headers: AUTH,
      });
      await res.arrayBuffer();
      return { ms: performance.now() - started, status: res.status };
    }

    seq += 1;
    // Coordinates spread across a wide grid so the proximity dedupe does not
    // merge them, which would measure the merge path instead of the insert.
    const n = (seq * 100000) % 4000000;
    const lat = Number((18.0 + Math.floor(n / 2000) * 0.002).toFixed(5));
    const lng = Number((73.0 + (n % 2000) * 0.002).toFixed(5));
    const partition = options.spreadZones ? seq % options.spreadZones : 0;

    const res = await fetch(`${options.target}/authority/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify({
        district: options.spreadZones ? `D${partition}` : 'PUN',
        zone: options.spreadZones ? `Z${partition}` : 'Z1',
        description: `probe ${RUN_ID} ${seq}`,
        lat,
        lng,
      }),
    });
    await res.arrayBuffer();
    return { ms: performance.now() - started, status: res.status };
  } catch {
    // Status 0 marks a transport failure. Counted once, in the status map, so
    // the summary cannot disagree with itself.
    return { ms: performance.now() - started, status: 0 };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

async function runFor(seconds: number, record: boolean): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (Date.now() < deadline) {
        const { ms, status } = await oneRequest();
        if (record) {
          completed += 1;
          latencies.push(ms);
          statuses.set(status, (statuses.get(status) ?? 0) + 1);
        }
      }
    }),
  );
}

console.log(
  `mode=${options.mode} concurrency=${options.concurrency} ` +
    `target=${options.target} spreadZones=${options.spreadZones}`,
);

// Warm-up is not recorded: JIT tiering, lazy module loading and first-query
// planning all land in the first requests, and including them would overstate
// per-request cost.
await runFor(options.warmupSeconds, false);

const startedAt = Date.now();
await runFor(options.seconds, true);
const elapsed = (Date.now() - startedAt) / 1000;

const sorted = [...latencies].sort((a, b) => a - b);
const mix = [...statuses.entries()].sort((a, b) => b[1] - a[1])
  .map(([s, n]) => `${s}:${n}`).join(' ');

console.log(`\nelapsed        : ${elapsed.toFixed(1)}s`);
console.log(`completed      : ${completed}`);
console.log(`transport errs : ${statuses.get(0) ?? 0}`);
console.log(`throughput     : ${(completed / elapsed).toFixed(1)} req/s`);
console.log(`status mix     : ${mix}`);
console.log(`p50            : ${percentile(sorted, 50).toFixed(2)} ms`);
console.log(`p90            : ${percentile(sorted, 90).toFixed(2)} ms`);
console.log(`p99            : ${percentile(sorted, 99).toFixed(2)} ms`);
console.log(`max            : ${(sorted[sorted.length - 1] ?? 0).toFixed(2)} ms`);
console.log(`mean           : ${(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)).toFixed(2)} ms`);
