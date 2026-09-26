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
const LAT_SPAN = 500;
const LNG_SPAN = 750;

// Unique per run so deriveIdempotencyKey cannot replay a previous run's
// response and make the row reconciliation look correct when nothing was
// actually written.
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

let counter = 0;
const TOTAL_CELLS = LAT_SPAN * LNG_SPAN;

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health 200': r => r.status === 200 });

  // Each iteration gets a distinct cell. The arrival-rate executor hands
  // iterations to whichever VU is free, so __VU/__ITER alone would collide;
  // a monotonic counter keeps cells unique across the whole run.
  counter += 1;
  const n = counter % TOTAL_CELLS;
  const lat = Number((LAT_MIN + Math.floor(n / LNG_SPAN) * LAT_STEP).toFixed(5));
  const lng = Number((LNG_MIN + (n % LNG_SPAN) * LNG_STEP).toFixed(5));

  const res = http.post(
    `${BASE_URL}/authority/complaints`,
    JSON.stringify({
      district: 'PUN',
      zone: 'Z1',
      description: `soak ${RUN_ID}-${counter}`,
      lat,
      lng,
    }),
    { headers: { 'Content-Type': 'application/json', ...AUTH } },
  );

  check(res, {
    'create 2xx': r => r.status === 200 || r.status === 429,
    'accepted not merged': r => r.status !== 200 || r.json('merged') === false,
  });

  sleep(0.2);
}
