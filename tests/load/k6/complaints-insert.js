import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';

// Insert-path load profile.
//
// The default `complaints.js` sends a constant lat/lng. The create route
// deduplicates any complaint within MERGE_RADIUS_M (100 m) of an existing open
// complaint, so every request there merges into the first one and the INSERT
// path is never exercised — a 3-minute run produced a single complaint row with
// report_count = 38638.
//
// This profile spreads coordinates across a grid with ~200 m spacing so every
// request is a genuinely new complaint, which is what a write-path capacity
// measurement needs.
//
// Grid: 0.002 deg latitude is ~222 m, 0.002 deg longitude is ~193 m at 18 deg N.
// Both comfortably exceed the 100 m merge radius, so no two complaints collide.

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3100';
const ACCESS_SECRET = __ENV.ACCESS_SECRET || __ENV.JWT_SECRET || 'local_development_cryptographic_secret';

// Wider than the Pune deployment area on purpose: the point is to defeat
// proximity dedupe, not to model a real district.
const LAT_MIN = 18.0;
const LAT_STEP = 0.002;
const LNG_MIN = 73.0;
const LNG_STEP = 0.002;
const LAT_SPAN = 500; // 18.0 .. 19.0
const LNG_SPAN = 750; // 73.0 .. 74.5  => 375,000 distinct cells

// Without a per-run token the payload is byte-identical across runs, so
// deriveIdempotencyKey produces the same key and the gateway correctly replies
// with a replay instead of inserting. That is the idempotency contract working,
// but it means a second run silently measures replays rather than writes: an
// earlier run reported 12,388 "created" responses against 8,975 rows for
// exactly this reason. Real traffic is not byte-identical either.
const RUN_ID = __ENV.RUN_ID || String(Date.now());

export const options = {
  scenarios: {
    complaint_insert: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 500 },
        { duration: '1m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // The write path is a DB insert plus an outbox row, so it is slower than a
    // cached read. These are deliberately looser than the read profile and
    // exist to catch collapse, not to express an SLO.
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.35'],
    // Guards the specific failure this profile exists to prevent: silently
    // measuring the merge path again.
    checks: ['rate>0.60'],
  },
};

// encoding.b64encode accepts a string, []byte or ArrayBuffer directly. Passing
// a charCodeAt() array is rejected at runtime, which fails the iteration
// silently unless you read the k6 error log.
function base64url(value) {
  return encoding.b64encode(value, 'rawurl');
}

// Mirrors the gateway's JWT verification, which uses HS256 with the
// ACCESS_SECRET. Signed properly rather than hardcoded, so the test cannot pass
// while a real deployment would reject the token.
function jwtFor(sub) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub,
    phone: '+910000000000',
    phoneHash: 'loadtest',
    role: 'CE',
    districts: ['ALL'],
    zones: ['ALL'],
    iat: now,
    exp: now + 60 * 60,
  };
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = base64url(crypto.hmac('sha256', ACCESS_SECRET, signingInput, 'binary'));
  return `${signingInput}.${signature}`;
}

function authHeader() {
  return { Authorization: `Bearer ${jwtFor('00000000-0000-4000-8000-0000000000aa')}` };
}

/**
 * Deterministic cell for this VU/iteration pair.
 *
 * The VU stride must exceed the iterations a single VU performs, otherwise
 * `index % TOTAL` wraps and two VUs land on the same cell — which the
 * proximity dedupe then merges, so the run silently stops measuring inserts.
 * A VU completes roughly 50-60 iterations in this profile, so a stride of 100
 * keeps the maximum index (1000*100 + 99 = 100,099) well inside the grid.
 */
const VU_STRIDE = 100;

function cellFor(vu, iter) {
  const n = (vu * VU_STRIDE + (iter % VU_STRIDE)) % (LAT_SPAN * LNG_SPAN);
  return {
    lat: Number((LAT_MIN + Math.floor(n / LNG_SPAN) * LAT_STEP).toFixed(5)),
    lng: Number((LNG_MIN + (n % LNG_SPAN) * LNG_STEP).toFixed(5)),
  };
}

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health 200': r => r.status === 200 });

  const { lat, lng } = cellFor(__VU, __ITER);

  const payload = JSON.stringify({
    district: 'PUN',
    zone: 'Z1',
    description: `insert load ${RUN_ID}-${__VU}-${__ITER}`,
    lat,
    lng,
  });

  const res = http.post(`${BASE_URL}/authority/complaints`, payload, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });

  check(res, {
    'create 200': r => r.status === 200,
    // The assertion this profile exists for. If `merged` is true the request
    // collapsed into an existing complaint and the insert path was not measured.
    'created not merged': r => r.status === 200 && r.json('merged') === false,
  });

  sleep(1);
}
