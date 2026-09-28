import { check } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';

/**
 * Capacity-finding profile: ramping-arrival-rate.
 *
 * A VU-based ramp measures how fast the *generator* can push, which is not the
 * same as the arrival rate the system actually sustains once latency rises. An
 * arrival-rate ramp holds the offered load at each step regardless of how slow
 * the system becomes, so the point where latency diverges from the offered
 * rate is the real ceiling.
 *
 * Read and write paths are selected separately: they have very different costs
 * and quoting a single number hides that.
 *
 *   MODE=read  -> GET a paginated complaint list (touches Postgres)
 *   MODE=write -> POST a complaint (touches Redis, Postgres x~8, Kafka)
 */

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3100';
const ACCESS_SECRET = __ENV.ACCESS_SECRET || __ENV.JWT_SECRET || 'local_development_cryptographic_secret';
const MODE = __ENV.MODE || 'write';

const START_RPS = Number(__ENV.START_RPS || 50);
const PEAK_RPS = Number(__ENV.PEAK_RPS || 2000);
const STAGE = __ENV.STAGE || '30s';
const CONST_RPS = Number(__ENV.CONST_RPS || 0);
const DURATION = __ENV.DURATION || '60s';
const SPREAD_ZONES = Number(__ENV.SPREAD_ZONES || 0);

export const options = {
  scenarios: {
    capacity: {
      // CONST_RPS holds one offered rate for the whole run, which is how a
      // sustainable ceiling is found: a ramp is dominated by the collapse at
      // the top end, whereas a fixed rate shows whether that rate is held.
      ...(CONST_RPS
        ? {
            executor: 'constant-arrival-rate',
            rate: CONST_RPS,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: Number(__ENV.VUS || 150),
            maxVUs: Number(__ENV.MAX_VUS || 1500),
            gracefulStop: '20s',
          }
        : {
            executor: 'ramping-arrival-rate',
            startRate: START_RPS,
            timeUnit: '1s',
            preAllocatedVUs: Number(__ENV.VUS || 150),
            maxVUs: Number(__ENV.MAX_VUS || 1500),
            stages: [
              { target: START_RPS, duration: STAGE },
              { target: Math.round(PEAK_RPS * 1.5), duration: STAGE },
              { target: PEAK_RPS, duration: STAGE },
              { target: Math.round(PEAK_RPS * 2), duration: STAGE },
              { target: PEAK_RPS * 4, duration: STAGE },
            ],
            gracefulStop: '20s',
          }),
    },
  },
  // No thresholds: this run is looking for the knee, not pass/fail. A threshold
  // here would abort the ramp at exactly the point of interest.
  thresholds: {},
};

function base64url(v) {
  return encoding.b64encode(v, 'rawurl');
}

const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const claims = base64url(
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
const TOKEN = `${signingInput}.${base64url(crypto.hmac('sha256', ACCESS_SECRET, signingInput, 'binary'))}`;
const AUTH = { Authorization: `Bearer ${TOKEN}` };

// Coordinates far apart so writes are never merged by the proximity dedupe,
// which would measure the merge path instead of the insert path.
const RUN_ID = __ENV.RUN_ID || `cap-${Date.now()}`;
let seq = 0;

export default function () {
  if (MODE === 'read') {
    const res = http.get(`${BASE_URL}/authority/complaints?limit=20`, { headers: AUTH });
    check(res, { 'read ok': r => r.status === 200 });
    return;
  }

  seq += 1;
  // (__VU, __ITER) is unique per iteration in k6; the multiplier spreads cells
  // so two concurrent iterations do not land within the 100 m merge radius.
  const n = (__VU * 100000 + __ITER) % 4000000;
  const lat = Number((18.0 + Math.floor(n / 2000) * 0.002).toFixed(5));
  const lng = Number((73.0 + (n % 2000) * 0.002).toFixed(5));

  // SPREAD_ZONES fans writes across many district/zone partitions. The
  // proximity-dedupe query locks the newest rows *within a partition*, so a
  // single hot partition serialises every write to the same 25 rows. This
  // switch isolates that effect: same request shape, same volume, different
  // contention profile.
  const partition = SPREAD_ZONES ? __ITER % SPREAD_ZONES : 0;

  const res = http.post(
    `${BASE_URL}/authority/complaints`,
    JSON.stringify({
      district: SPREAD_ZONES ? `D${partition}` : 'PUN',
      zone: SPREAD_ZONES ? `Z${partition}` : 'Z1',
      description: `cap ${RUN_ID} ${__VU} ${__ITER}`,
      lat,
      lng,
    }),
    { headers: { 'Content-Type': 'application/json', ...AUTH } },
  );
  check(res, { 'write ok': r => r.status === 200 || r.status === 429 });
}
