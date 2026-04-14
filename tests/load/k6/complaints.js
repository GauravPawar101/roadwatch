import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const JWT_SECRET = __ENV.JWT_SECRET || 'local_development_cryptographic_secret';

export const options = {
  scenarios: {
    complaints: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 500 },
        { duration: '1m', target: 1000 },
        { duration: '30s', target: 0 }
      ]
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500']
  }
};

function base64url(bytes) {
  return encoding.b64encode(bytes, 'rawurl');
}

function jwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const msg = `${encHeader}.${encPayload}`;
  const sig = crypto.hmac('sha256', secret, msg, 'binary');
  return `${msg}.${base64url(sig)}`;
}

function authHeader() {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtHS256(
    {
      sub: 'loadtest-user',
      phone: '+91******0000',
      phoneHash: 'loadtest',
      role: 'CE',
      districts: ['ALL'],
      zones: ['ALL'],
      iat: now,
      exp: now + 60 * 60
    },
    JWT_SECRET
  );

  return { Authorization: `Bearer ${token}` };
}

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health 200': (r) => r.status === 200 });

  const payload = JSON.stringify({
    district: 'PUN',
    zone: 'Z1',
    description: `Load test complaint ${__VU}-${__ITER}`,
    lat: 18.52,
    lng: 73.85
  });

  const res = http.post(`${BASE_URL}/authority/complaints`, payload, {
    headers: { 'Content-Type': 'application/json', ...authHeader() }
  });

  check(res, {
    'create 200': (r) => r.status === 200,
    'create ok': (r) => r.json('ok') === true
  });

  sleep(1);
}
