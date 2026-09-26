import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';

// Soak profile: constant, moderate load for a long duration.
//
// Purpose is not throughput. It is to answer three questions a 3-minute ramp
// cannot:
//   1. Does gateway RSS plateau, or grow without bound (a real leak)?
//   2. Does the outbox stay drained, or does backlog creep up over time?
//   3. Do responses still reconcile with rows written, hours in?
//
// Constant arrival rate rather than constant VUs, so the offered load does not
// drift as latency changes — otherwise a slow system quietly tests itself less.

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3100';
const ACCESS_SECRET = __ENV.ACCESS_SECRET || __ENV.JWT_SECRET || 'local_development_cryptographic_secret';

const RATE = Number(__ENV.SOAK_RATE || 20); // requests per second
const DURATION = __ENV.SOAK_DURATION || '30m';
const PREALLOCATED_VUS = Number(__ENV.SOAK_VUS || 60);

const LAT_MIN = 18.0;
const LAT_STEP = 0.002;
const LNG_MIN = 73.0;
const LNG_STEP = 0.002;
const LAT_SPAN = 2000; // 18.0 .. 22.0
const LNG_SPAN = 2000; // 73.0 .. 77.0 => 4,000,000 distinct cells
const TOTAL_CELLS = LAT_SPAN * LNG_SPAN;

// Unique per run AND per iteration.
//
// The first version of this profile used a module-level `let counter`, which
// looks global but is per-VU: every VU in k6 has its own JS runtime, so each
// started at 1 and produced byte-identical payloads. Idempotency then correctly
// replayed them, and a 30-minute run of 36,001 requests wrote only 601 rows. The
// data flow was flawless (601 rows, 601 outbox events, 601 SLA rows, 0 orphaned
// claims, 0 double-counted reports) but the test was not exercising what it
// claimed to.
//
// (__VU, __ITER) is unique across a k6 run, so the request body — and therefore
// the derived idempotency key — differs on every iteration.
const RUN_ID = __ENV.RUN_ID || `soak-${Date.now()}`;

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: PREALLOCATED_VUS,
      maxVUs: PREALLOCATED_VUS * 3,
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Deliberately loose. A soak asserts stability over time, not a latency
    // budget; anything that trips here is a genuine problem, not a slow patch.
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.10'],
    checks: ['rate>0.85'],
  },
};

function base64url(value) {
  return encoding.b64encode(value, 'rawurl');
}

function jwtFor(sub) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub,
    phone: '+910000000000',
    phoneHash: 'soak',
    role: 'CE',
    districts: ['ALL'],
    zones: ['ALL'],
    iat: now,
    exp: now + 60 * 60 * 12,
  };
  const signingInput = `${header}.${base64url(JSON.stringify(claims))}`;
  return `${signingInput}.${base64url(crypto.hmac('sha256', ACCESS_SECRET, signingInput, 'binary'))}`;
}

const AUTH = { Authorization: `Bearer ${jwtFor('00000000-0000-4000-8000-0000000000bb')}` };

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health 200': r => r.status === 200 });

  // Wide grid so two iterations do not land on the same cell: at 200 m pitch a
  // collision would be merged by the proximity dedupe and inflate
  // report_count, which is exactly the corruption the soak must not introduce.
  // VU_STRIDE exceeds the iterations any single VU performs in this profile.
  const VU_STRIDE = 2000;
  const n = (__VU * VU_STRIDE + __ITER) % TOTAL_CELLS;
  const lat = Number((LAT_MIN + Math.floor(n / LNG_SPAN) * LAT_STEP).toFixed(5));
  const lng = Number((LNG_MIN + (n % LNG_SPAN) * LNG_STEP).toFixed(5));

  const res = http.post(
    `${BASE_URL}/authority/complaints`,
    JSON.stringify({
      district: 'PUN',
      zone: 'Z1',
      description: `soak ${RUN_ID}-${__VU}-${__ITER}`,
      lat,
      lng,
    }),
    { headers: { 'Content-Type': 'application/json', ...AUTH } },
  );

  // 200 and 429 are reported separately. The first version of this check
  // accepted either as "2xx", which made a run that was 98% rejected look like
  // a healthy one.
  check(res, {
    'create accepted': r => r.status === 200,
    'accepted not merged': r => r.status !== 200 || r.json('merged') === false,
    'rate limited': r => r.status === 200 || r.status === 429,
  });

  sleep(0.2);
}
