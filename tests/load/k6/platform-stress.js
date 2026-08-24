import { check, group, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.TARGET_URL || 'http://127.0.0.1:30100').replace(/\/$/, '');
const JWT_SECRET = __ENV.JWT_SECRET || 'roadwatch-local-dev-jwt-secret-replace-in-production';
const TIER = (__ENV.STRESS_TIER || 'medium').toLowerCase();
const PATTERN = (__ENV.STRESS_PATTERN || 'ramp').toLowerCase();
const DURATION = __ENV.STRESS_DURATION || '20m';
const READS_ONLY = String(__ENV.READS_ONLY || '').toLowerCase() === '1' || String(__ENV.READS_ONLY || '').toLowerCase() === 'true';

const createOk = new Rate('complaint_create_ok');
const listOk = new Rate('complaint_list_ok');
const healthOk = new Rate('health_ok');
const createLatency = new Trend('complaint_create_ms', true);
const errorsByStatus = new Counter('http_status_errors');

const DELHI = { lat: 28.6139, lng: 77.209 };
const DISTRICTS = [
  { code: 'New Delhi', lat: 28.6139, lng: 77.209 },
  { code: 'South Delhi', lat: 28.5245, lng: 77.2066 },
  { code: 'East Delhi', lat: 28.6280, lng: 77.2950 },
];
const DAMAGE = ['pothole', 'crack', 'shoulder', 'drainage', 'signage'];

const TIER_VUS = {
  smoke: 2,
  low: 10,
  medium: 40,
  high: 120,
  spike: 250,
};

function parseDurationToSeconds(raw) {
  const m = String(raw).trim().match(/^(\d+)(s|m|h)?$/i);
  if (!m) return 20 * 60;
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  if (unit === 's') return n;
  if (unit === 'h') return n * 3600;
  return n * 60;
}

function formatDur(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function buildStages(pattern, durationSec, peakVus) {
  const d = Math.max(60, durationSec);
  if (pattern === 'steady') {
    return [
      { duration: '30s', target: Math.max(1, Math.floor(peakVus * 0.5)) },
      { duration: formatDur(d - 60), target: peakVus },
      { duration: '30s', target: 0 },
    ];
  }
  if (pattern === 'burst') {
    const burst = Math.max(30, Math.floor(d / 8));
    const quiet = Math.max(30, Math.floor(d / 8));
    const stages = [];
    let remaining = d;
    let high = true;
    while (remaining > 0) {
      const slice = Math.min(high ? burst : quiet, remaining);
      stages.push({ duration: formatDur(slice), target: high ? peakVus : Math.max(1, Math.floor(peakVus * 0.15)) });
      remaining -= slice;
      high = !high;
    }
    stages.push({ duration: '20s', target: 0 });
    return stages;
  }
  if (pattern === 'wave') {
    const quarter = Math.max(45, Math.floor(d / 4));
    return [
      { duration: formatDur(quarter), target: Math.max(1, Math.floor(peakVus * 0.3)) },
      { duration: formatDur(quarter), target: peakVus },
      { duration: formatDur(quarter), target: Math.max(1, Math.floor(peakVus * 0.25)) },
      { duration: formatDur(Math.max(30, d - 3 * quarter)), target: Math.max(1, Math.floor(peakVus * 0.8)) },
      { duration: '30s', target: 0 },
    ];
  }
  // ramp (default)
  const rampUp = Math.max(60, Math.floor(d * 0.25));
  const hold = Math.max(60, Math.floor(d * 0.55));
  const rampDown = Math.max(30, d - rampUp - hold);
  return [
    { duration: formatDur(rampUp), target: peakVus },
    { duration: formatDur(hold), target: peakVus },
    { duration: formatDur(rampDown), target: 0 },
  ];
}

const peak = TIER_VUS[TIER] ?? TIER_VUS.medium;
const durationSec = parseDurationToSeconds(DURATION);
const stages = buildStages(PATTERN, durationSec, peak);

const thresholds = {
  http_req_failed: ['rate<0.05'],
  http_req_duration: ['p(95)<3000'],
  health_ok: ['rate>0.95'],
};
if (!READS_ONLY) {
  thresholds.complaint_create_ok = ['rate>0.85'];
}

export const options = {
  scenarios: {
    platform: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages,
      gracefulRampDown: '30s',
    },
  },
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function base64url(input) {
  // Pass strings and binary (ArrayBuffer) through; never String(binary).
  return encoding.b64encode(input, 'rawurl');
}

function jwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const msg = `${encHeader}.${encPayload}`;
  const sig = crypto.hmac('sha256', secret, msg, 'binary');
  return `${msg}.${base64url(sig)}`;
}

function uuidForVu(vu) {
  // Deterministic UUID-shaped sub — complaints.user_id is uuid-typed.
  const hex = (`000000000000${Number(vu).toString(16)}`).slice(-12);
  return `01900000-0000-7000-8000-${hex}`;
}

function authHeader() {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtHS256(
    {
      sub: uuidForVu(__VU),
      phone: `+91991000${String(1000 + (__VU % 8000)).padStart(4, '0')}`,
      phoneHash: `stress-${__VU}`,
      role: 'CE',
      districts: ['ALL'],
      zones: ['ALL'],
      iat: now,
      exp: now + 60 * 60,
    },
    JWT_SECRET
  );
  return { Authorization: `Bearer ${token}` };
}

function jitter(base, spread) {
  return base + (Math.random() * 2 - 1) * spread;
}

function delhiPayload() {
  const district = DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)];
  const damage = DAMAGE[Math.floor(Math.random() * DAMAGE.length)];
  const severity = 1 + Math.floor(Math.random() * 5);
  // Authority create schema: district, zone, description, lat?, lng?
  return {
    district: district.code,
    zone: 'Central',
    description: `[${damage}|sev${severity}|${district.code}|ND-${10 + (__VU % 40)}A] Stress ${TIER}/${PATTERN} VU${__VU}#${__ITER}: Delhi Ring Road fixture for Kafka/HLF soak.`,
    lat: jitter(district.lat, 0.04),
    lng: jitter(district.lng, 0.04),
  };
}

export function setup() {
  const health = http.get(`${BASE_URL}/health`);
  return {
    baseUrl: BASE_URL,
    tier: TIER,
    pattern: PATTERN,
    duration: DURATION,
    peakVus: peak,
    healthStatus: health.status,
    startedAt: new Date().toISOString(),
  };
}

export default function () {
  const headers = { 'Content-Type': 'application/json', ...authHeader() };

  group('health', () => {
    const health = http.get(`${BASE_URL}/health`);
    const ok = check(health, { 'health 200': (r) => r.status === 200 });
    healthOk.add(ok);
    if (!ok) errorsByStatus.add(1, { status: String(health.status) });
  });

  if (!READS_ONLY) {
    group('create_complaint', () => {
      const body = JSON.stringify(delhiPayload());
      const res = http.post(`${BASE_URL}/authority/complaints`, body, { headers });
      createLatency.add(res.timings.duration);
      const ok = check(res, {
        'create accepted': (r) => r.status === 200 || r.status === 201 || r.status === 202,
      });
      createOk.add(ok);
      if (!ok) errorsByStatus.add(1, { status: String(res.status) });
    });
  }

  group('list_and_heatmap', () => {
    const list = http.get(`${BASE_URL}/complaints?limit=50&status=Open,InProgress,FILED`, { headers });
    const listPass = check(list, {
      'list ok-ish': (r) => r.status === 200 || r.status === 401 || r.status === 403,
    });
    listOk.add(list.status === 200);
    if (!listPass) errorsByStatus.add(1, { status: String(list.status) });

    http.get(`${BASE_URL}/complaints/heatmap/data?status=Open,InProgress,FILED`, { headers });
  });

  // Think time scales inversely with tier aggressiveness
  const think =
    TIER === 'spike' ? 0.05 :
    TIER === 'high' ? 0.15 :
    TIER === 'medium' ? 0.4 :
    TIER === 'low' ? 0.8 : 1.2;
  sleep(think + Math.random() * 0.2);
}

export function handleSummary(data) {
  // Prefer CLI --summary-export from stress-platform.mjs; keep a compact stdout summary.
  const failed = data.metrics?.http_req_failed?.values?.rate;
  const dur = data.metrics?.http_req_duration?.values?.['p(95)'];
  const create = data.metrics?.complaint_create_ok?.values?.rate;
  return {
    stdout: [
      `\nstress tier=${TIER} pattern=${PATTERN} duration=${DURATION}`,
      `http_req_failed rate=${failed}`,
      `http_req_duration p95=${dur}`,
      `complaint_create_ok rate=${create}`,
      '',
    ].join('\n'),
  };
}
