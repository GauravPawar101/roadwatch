/**
 * Micro-benchmarks the per-request costs the profile pointed at, so the
 * attribution can be checked rather than assumed.
 *
 * The profile attributed 8.6% of process CPU to `createPublicKey` during a
 * JWT-verified read path, but the only `createPublicKey` reference in the
 * verification chain is a `typeof` feature check in jwa, which cannot plausibly
 * cost that. So it is measured here directly: if verifying 10,000 tokens is
 * cheap, the profile's attribution is wrong and the fix belongs elsewhere.
 *
 * Each case is timed over enough iterations that the number is stable, and the
 * per-operation cost is printed next to what it would cost at a given rate.
 *
 * Usage: npx tsx tools/profile/micro.mts
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const N = Number(process.env.N ?? 20_000);

function bench(label: string, fn: () => void): void {
  // One untimed pass so JIT has seen the code before the measured loop.
  for (let i = 0; i < Math.min(1000, N); i += 1) fn();

  const started = process.hrtime.bigint();
  for (let i = 0; i < N; i += 1) fn();
  const ns = Number(process.hrtime.bigint() - started);
  const perOp = ns / N;

  // perOp is nanoseconds. At 10,000 ops/s the elapsed time is perOp * 10,000 ns,
  // and one core-second is 1e9 ns, so the share of a core is that over 1e9.
  const shareAt10k = (perOp * 10_000) / 1e9;
  console.log(
    `${label.padEnd(38)} ${(perOp / 1000).toFixed(3).padStart(9)} us/op` +
      `   @10k/s = ${(shareAt10k * 100).toFixed(1).padStart(6)}% of one core`,
  );
}

console.log(`iterations: ${N.toLocaleString()}\n`);

// ── JWT verify, the cost every authenticated request pays ────────────────
const SECRET = 'a-strong-local-development-secret-of-sufficient-length-0123456789';
const now = Math.floor(Date.now() / 1000);
const b64 = (v: object): string =>
  Buffer.from(JSON.stringify(v)).toString('base64url');

const header = b64({ alg: 'HS256', typ: 'JWT' });
const claims = b64({
  sub: '00000000-0000-4000-8000-0000000000ff',
  role: 'CE',
  districts: ['ALL'],
  zones: ['ALL'],
  iat: now,
  exp: now + 43_200,
});
const signingInput = `${header}.${claims}`;
const TOKEN = `${signingInput}.${crypto.createHmac('sha256', SECRET).update(signingInput).digest('base64url')}`;

bench('jwt.verify (HS256, string secret)', () => {
  jwt.verify(TOKEN, SECRET);
});

// A KeyObject instead of a string. If this is materially faster, the fix is to
// build the key once at startup and pass it, instead of letting the library
// re-derive one per call.
const keyObject = crypto.createSecretKey(Buffer.from(SECRET, 'utf8'));
bench('jwt.verify (HS256, KeyObject)', () => {
  jwt.verify(TOKEN, keyObject);
});

// What the gateway actually pays: verify, then the UUID check on `sub`.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
bench('verify + sub UUID check (full cost)', () => {
  const payload = jwt.verify(TOKEN, SECRET) as { sub: string };
  if (!UUID_RE.test(payload.sub)) throw new Error('bad sub');
});

// ── The other per-request costs the profile named ────────────────────────
const UUIDS = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
const ROWS = UUIDS.map((id, i) => ({
  id,
  district: `LOAD${i % 40}`,
  zone: `Z${i % 12}`,
  status: 'FILED',
  description: `[load] row ${i} — fixture for the paginated complaint list read path, with enough text to be realistic`,
  lat: 18.0 + i * 0.002,
  lng: 73.0 + i * 0.002,
  created_at: new Date(),
  updated_at: new Date(),
  fabric_txid: null,
}));

bench('JSON.stringify(20 rows)', () => {
  JSON.stringify({ complaints: ROWS, pagination: { limit: 20, offset: 0, returned: 20, hasMore: true } });
});

const STRINGS = Array.from({ length: 20 }, (_, i) => `row-${i}-${'x'.repeat(120)}`);
bench('Buffer.from(20 x 150-char strings)', () => {
  for (const s of STRINGS) Buffer.from(s, 'utf8');
});

bench('20 x new Date() (postgres-date equiv)', () => {
  for (let i = 0; i < 20; i += 1) new Date(`2026-09-27 10:00:00.${String(i).padStart(3, '0')}+00`);
});

console.log('\nThe @10k/s column is what each would consume as a share of one core at 10,000 requests per second.');
