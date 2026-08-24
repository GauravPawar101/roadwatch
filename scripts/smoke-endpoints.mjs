#!/usr/bin/env node
/**
 * HTTP endpoint smoke checks for gateway-api (and backend-api / media-ingest when up).
 *
 *   node scripts/smoke-endpoints.mjs
 *   TARGET_URL=http://127.0.0.1:3100 node scripts/smoke-endpoints.mjs
 *   pnpm smoke:endpoints
 *
 * Multipart/image checks use files from <repo>/img (reze.jpeg).
 * Does not print secrets. Destructive routes (DELETE /auth/me, suspend) are skipped.
 */
import crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const imgDir = path.join(repoRoot, 'img');
const password = process.env.SMOKE_PASSWORD || 'RoadWatch@123';

const DEMO = {
  citizen: ['citizen.new-delhi.01@roadwatch.local', 'citizen.new-delhi.01'],
  authority: ['super.admin.01@roadwatch.local', 'super.admin.01'],
  contractor: ['superbuild-infra@roadwatch.local', 'superbuild-infra'],
};

const results = [];
let passCount = 0;
let failCount = 0;
let skipCount = 0;

function envFileValue(name) {
  if (process.env[name]) return process.env[name];
  const envPath = path.join(repoRoot, 'apps/gateway-api/.env');
  if (!existsSync(envPath)) return '';
  const text = readFileSync(envPath, 'utf8');
  const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '');
}

function loadAccessSecret() {
  return envFileValue('ACCESS_SECRET') || envFileValue('JWT_SECRET') || 'local_development_cryptographic_secret';
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function mintJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const msg = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('base64url');
  return `${msg}.${sig}`;
}

function listImageFiles() {
  if (!existsSync(imgDir)) return [];
  return readdirSync(imgDir)
    .filter((name) => /\.(jpe?g|png|webp|gif)$/i.test(name))
    .map((name) => path.join(imgDir, name))
    .sort();
}

function pickImagePath() {
  const files = listImageFiles();
  return files.find((f) => path.basename(f).toLowerCase() === 'reze.jpeg') || files[0] || null;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function record(row) {
  results.push(row);
  if (row.outcome === 'PASS') passCount += 1;
  else if (row.outcome === 'FAIL') failCount += 1;
  else skipCount += 1;
  const code = row.status == null ? '-' : String(row.status);
  const extra = row.detail ? `  (${row.detail})` : '';
  console.log(`[${row.outcome.padEnd(4)}] ${row.method.padEnd(6)} ${code.padStart(3)}  ${row.name}${extra}`);
}

function skip(name, method, url, detail) {
  record({ name, method, url, status: null, outcome: 'SKIP', detail });
}

async function probeHealth(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return res.ok && (body.status === 'ok' || body.status === 'healthy' || body.ok === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBase(envName, candidates) {
  if (process.env[envName]) return process.env[envName].replace(/\/$/, '');
  for (const url of candidates) {
    if (await probeHealth(url)) return url;
  }
  return null;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token) {
  return { ...bearer(token), 'Content-Type': 'application/json' };
}

function asList(payload, keys) {
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return Array.isArray(payload) ? payload : [];
}

function firstId(item) {
  if (!item || typeof item !== 'object') return null;
  return item.id || item.districtId || item.roadId || item.authorityId || item.code || null;
}

function extractPoint(geometry) {
  if (!geometry) return null;
  const geo = typeof geometry === 'string'
    ? (() => { try { return JSON.parse(geometry); } catch { return null; } })()
    : geometry;
  if (!geo || typeof geo !== 'object') return null;
  const walk = (coords) => {
    if (!Array.isArray(coords) || coords.length === 0) return null;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return { lng: coords[0], lat: coords[1] };
    }
    return walk(coords[0]);
  };
  if (geo.type === 'Point' && Array.isArray(geo.coordinates)) {
    return { lng: geo.coordinates[0], lat: geo.coordinates[1] };
  }
  return walk(geo.coordinates);
}

function isRetryableNetworkError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|aborted/i.test(msg);
}

async function rawFetch(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, init, timeoutMs, attempts = 3) {
  let lastErr;
  const origin = new URL(url).origin;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await rawFetch(url, init, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!isRetryableNetworkError(err)) throw err;
      await waitUntilHealthy(origin, 20000);
    }
  }
  throw lastErr;
}

async function waitUntilHealthy(origin, budgetMs) {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (await probeHealth(origin)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function hit({ name, method, url, headers, body, expected, timeoutMs = 15000, parseJson = true }) {
  try {
    const res = await fetchWithRetry(url, { method, headers, body }, timeoutMs);
    let json = null;
    const contentType = res.headers.get('content-type') || '';
    if (parseJson && contentType.includes('json')) {
      json = await res.json().catch(() => null);
    } else {
      await res.arrayBuffer().catch(() => null);
    }
    const ok = expected.includes(res.status);
    const errMsg = json && typeof json === 'object' ? json.error || json.message || json.code : '';
    record({
      name,
      method,
      url,
      status: res.status,
      outcome: ok ? 'PASS' : 'FAIL',
      detail: ok ? '' : String(errMsg || '').slice(0, 160),
    });
    return { status: res.status, json, res };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record({ name, method, url, status: null, outcome: 'FAIL', detail: msg });
    return { status: null, json: null, res: null };
  }
}

async function login(base, route, identifiers) {
  const payloads = [];
  for (const identifier of identifiers) {
    payloads.push({ identifier, password });
    payloads.push({ identifier, password });
  }
  for (const payload of payloads) {
    try {
      const res = await fetchWithRetry(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 15000);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.token) {
        return { token: json.token, user: json.user || {}, status: res.status };
      }
    } catch {
      // try next identifier/shape
    }
  }
  return null;
}

async function main() {
  const imageFiles = listImageFiles();
  const imagePath = pickImagePath();
  console.log(`img files: ${imageFiles.length ? imageFiles.map((f) => path.basename(f)).join(', ') : '(none)'}`);

  const gateway = (await resolveBase('TARGET_URL', ['http://127.0.0.1:3100', 'http://127.0.0.1:30100']))
    || (process.env.TARGET_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
  const backend = await resolveBase('BACKEND_URL', ['http://127.0.0.1:4001', 'http://127.0.0.1:30401']);
  const mediaIngest = await resolveBase('MEDIA_INGEST_URL', ['http://127.0.0.1:4000']);

  console.log(`gateway: ${gateway}`);
  console.log(`backend: ${backend || '(not reachable)'}`);
  console.log(`media-ingest: ${mediaIngest || '(not reachable)'}`);

  if (!(await probeHealth(gateway))) {
    record({
      name: 'gateway /health',
      method: 'GET',
      url: `${gateway}/health`,
      status: null,
      outcome: 'FAIL',
      detail: 'gateway not reachable. Start it, then re-run with TARGET_URL (default http://127.0.0.1:3100, Kind NodePort http://127.0.0.1:30100)',
    });
    printSummary();
    process.exit(1);
  }

  await hit({ name: 'GET /health', method: 'GET', url: `${gateway}/health`, expected: [200] });
  await hit({ name: 'GET /health/status', method: 'GET', url: `${gateway}/health/status`, expected: [200, 503] });
  await hit({ name: 'GET /health/services', method: 'GET', url: `${gateway}/health/services`, expected: [200] });
  await hit({
    name: 'GET /metrics/admission',
    method: 'GET',
    url: `${gateway}/metrics/admission`,
    expected: [200, 503],
    parseJson: false,
  });

  const countries = await hit({
    name: 'GET /public/countries',
    method: 'GET',
    url: `${gateway}/public/countries`,
    expected: [200],
  });
  const countryCode = asList(countries.json, ['countries']).map((c) => c.code || c.id).find(Boolean) || 'IN';
  const states = await hit({
    name: 'GET /public/states',
    method: 'GET',
    url: `${gateway}/public/states?country=${encodeURIComponent(countryCode)}`,
    expected: [200, 400],
  });
  const stateCode = asList(states.json, ['states']).map((s) => s.code || s.id).find(Boolean) || 'DL';
  const districts = await hit({
    name: 'GET /public/districts',
    method: 'GET',
    url: `${gateway}/public/districts?country=${encodeURIComponent(countryCode)}&state=${encodeURIComponent(stateCode)}`,
    expected: [200, 400],
  });
  const districtRow = asList(districts.json, ['districts'])[0] || null;
  const districtId = firstId(districtRow);

  let roadId = null;
  let roadPoint = { lat: 28.6139, lng: 77.209 };
  let authorityId = null;
  if (districtId) {
    await hit({
      name: 'GET /public/districts/:id/offline-manifest',
      method: 'GET',
      url: `${gateway}/public/districts/${districtId}/offline-manifest`,
      expected: [200, 404],
    });
    const roads = await hit({
      name: 'GET /public/districts/:id/roads',
      method: 'GET',
      url: `${gateway}/public/districts/${districtId}/roads`,
      expected: [200, 404],
    });
    const road = asList(roads.json, ['roads'])[0];
    if (road) {
      roadId = firstId(road);
      authorityId = road.authorityId || road.authority_id || null;
      const pt = extractPoint(road.geometry);
      if (pt) roadPoint = pt;
    }
  } else {
    skip('GET /public/districts/:id/roads', 'GET', `${gateway}/public/districts/:id/roads`, 'no district id');
  }

  await hit({
    name: 'GET /public/roads/segments.geojson',
    method: 'GET',
    url: `${gateway}/public/roads/segments.geojson?lat=${roadPoint.lat}&lng=${roadPoint.lng}&limit=50`,
    expected: [200, 400],
  });
  await hit({ name: 'GET /public/dashboard', method: 'GET', url: `${gateway}/public/dashboard`, expected: [200] });
  await hit({ name: 'GET /public/chronic-roads', method: 'GET', url: `${gateway}/public/chronic-roads`, expected: [200] });
  await hit({
    name: 'GET /public/contractors/scorecard',
    method: 'GET',
    url: `${gateway}/public/contractors/scorecard`,
    expected: [200],
  });
  await hit({
    name: 'GET /public/proposals/intelligence',
    method: 'GET',
    url: `${gateway}/public/proposals/intelligence`,
    expected: [200],
  });
  await hit({ name: 'GET /public/hotspots', method: 'GET', url: `${gateway}/public/hotspots`, expected: [200] });
  await hit({ name: 'GET /public/trends', method: 'GET', url: `${gateway}/public/trends`, expected: [200] });
  await hit({
    name: 'GET /public/rti/:shareToken (missing)',
    method: 'GET',
    url: `${gateway}/public/rti/not-a-real-share-token`,
    expected: [404],
  });
  if (roadId) {
    const roadRes = await hit({
      name: 'GET /public/roads/:roadId',
      method: 'GET',
      url: `${gateway}/public/roads/${encodeURIComponent(roadId)}`,
      expected: [200, 404],
    });
    const pt = extractPoint(roadRes.json?.road?.geometry);
    if (pt) roadPoint = pt;
    authorityId = authorityId || roadRes.json?.road?.authorityId || null;
  }
  if (authorityId) {
    await hit({
      name: 'GET /public/authorities/:authorityId',
      method: 'GET',
      url: `${gateway}/public/authorities/${encodeURIComponent(authorityId)}`,
      expected: [200, 404],
    });
  }
  await hit({
    name: 'POST /public/agent/chat',
    method: 'POST',
    url: `${gateway}/public/agent/chat`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'Summarize open pothole complaints in New Delhi in one sentence.' }),
    expected: [200, 400, 502],
    timeoutMs: 45000,
  });

  const secret = loadAccessSecret();
  const now = Math.floor(Date.now() / 1000);
  const citizenLogin = await login(gateway, '/auth/citizen/login', DEMO.citizen);
  const authorityLogin = await login(gateway, '/auth/authority/login', DEMO.authority);
  const contractorLogin = await login(gateway, '/auth/contractor/login', DEMO.contractor);

  record({
    name: 'POST /auth/citizen/login',
    method: 'POST',
    url: `${gateway}/auth/citizen/login`,
    status: citizenLogin?.status ?? 401,
    outcome: citizenLogin ? 'PASS' : 'FAIL',
    detail: citizenLogin ? '' : 'demo citizen login failed; minting JWT fallback',
  });
  record({
    name: 'POST /auth/authority/login',
    method: 'POST',
    url: `${gateway}/auth/authority/login`,
    status: authorityLogin?.status ?? 401,
    outcome: authorityLogin ? 'PASS' : 'FAIL',
    detail: authorityLogin ? '' : 'demo authority login failed; minting JWT fallback',
  });
  record({
    name: 'POST /auth/contractor/login',
    method: 'POST',
    url: `${gateway}/auth/contractor/login`,
    status: contractorLogin?.status ?? 401,
    outcome: contractorLogin ? 'PASS' : 'FAIL',
    detail: contractorLogin ? '' : 'demo contractor login failed; minting JWT fallback',
  });

  const citizenToken = citizenLogin?.token || mintJwt({
    sub: '01900000-0000-7000-8000-00000000c101',
    phone: '+919920000001',
    phoneHash: 'smoke-citizen',
    role: 'CITIZEN',
    districts: [],
    zones: [],
    iat: now,
    exp: now + 3600,
  }, secret);
  const authorityToken = authorityLogin?.token || mintJwt({
    sub: '01900000-0000-7000-8000-00000000c001',
    phone: '+919900000001',
    phoneHash: 'smoke-ce',
    role: 'CE',
    districts: ['ALL'],
    zones: ['ALL'],
    iat: now,
    exp: now + 3600,
  }, secret);
  const contractorToken = contractorLogin?.token || mintJwt({
    sub: '01900000-0000-7000-8000-00000000c201',
    phone: '+919930000001',
    phoneHash: 'smoke-contractor',
    role: 'CONTRACTOR',
    districts: ['New Delhi'],
    zones: ['ALL'],
    iat: now,
    exp: now + 3600,
  }, secret);

  await hit({
    name: 'GET /auth/me (citizen)',
    method: 'GET',
    url: `${gateway}/auth/me`,
    headers: bearer(citizenToken),
    expected: [200],
  });
  await hit({
    name: 'POST /auth/refresh (no cookie)',
    method: 'POST',
    url: `${gateway}/auth/refresh`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    expected: [400, 401],
  });
  await hit({
    name: 'POST /auth/logout',
    method: 'POST',
    url: `${gateway}/auth/logout`,
    headers: jsonHeaders(citizenToken),
    body: JSON.stringify({}),
    expected: [200, 204, 401],
  });
  await hit({
    name: 'POST /auth/citizen/otp/request',
    method: 'POST',
    url: `${gateway}/auth/citizen/otp/request`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+919920000001' }),
    expected: [200, 400, 429],
  });
  await hit({
    name: 'GET /auth/citizen/otp/status',
    method: 'GET',
    url: `${gateway}/auth/citizen/otp/status?phone=${encodeURIComponent('+919920000001')}`,
    expected: [200, 400, 404],
  });
  await hit({
    name: 'POST /auth/citizen/otp/verify (bogus)',
    method: 'POST',
    url: `${gateway}/auth/citizen/otp/verify`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+919920000001', code: '000000' }),
    expected: [400, 401],
  });
  await hit({
    name: 'POST /auth/authority/otp/request',
    method: 'POST',
    url: `${gateway}/auth/authority/otp/request`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: DEMO.authority[1] }),
    expected: [200, 400, 403, 429],
  });
  await hit({
    name: 'POST /auth/contractor/otp/request',
    method: 'POST',
    url: `${gateway}/auth/contractor/otp/request`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: DEMO.contractor[1] }),
    expected: [200, 400, 403, 429],
  });
  skip('DELETE /auth/me', 'DELETE', `${gateway}/auth/me`, 'destructive');
  skip('POST /auth/*/signup', 'POST', `${gateway}/auth/citizen/signup`, 'creates accounts');

  const capturedAt = new Date().toISOString();
  let citizenComplaintId = null;
  if (!imagePath) {
    skip('POST /citizen/media/upload', 'POST', `${gateway}/citizen/media/upload`, 'no files in img/');
  } else {
    const bytes = readFileSync(imagePath);
    const fileName = path.basename(imagePath);
    const mime = mimeFor(imagePath);

    const mediaForm = new FormData();
    mediaForm.set('image', new File([bytes], fileName, { type: mime }));
    mediaForm.set('capturedLat', String(roadPoint.lat));
    mediaForm.set('capturedLng', String(roadPoint.lng));
    mediaForm.set('capturedAt', capturedAt);
    await hit({
      name: 'POST /citizen/media/upload (img)',
      method: 'POST',
      url: `${gateway}/citizen/media/upload`,
      headers: bearer(citizenToken),
      body: mediaForm,
      expected: [200, 201, 409],
    });

    const complaintForm = new FormData();
    complaintForm.set('image', new File([bytes], fileName, { type: mime }));
    complaintForm.set('roadId', roadId || 'missing-road');
    complaintForm.set('description', `Smoke pothole photo ${Date.now()} near seeded Delhi fixture`);
    complaintForm.set('lat', String(roadPoint.lat));
    complaintForm.set('lng', String(roadPoint.lng));
    complaintForm.set('capturedLat', String(roadPoint.lat));
    complaintForm.set('capturedLng', String(roadPoint.lng));
    complaintForm.set('capturedAt', capturedAt);
    const created = await hit({
      name: 'POST /citizen/complaints (img)',
      method: 'POST',
      url: `${gateway}/citizen/complaints`,
      headers: { ...bearer(citizenToken), 'Idempotency-Key': `smoke-citizen-${Date.now()}` },
      body: complaintForm,
      expected: roadId ? [200, 201] : [400, 404],
    });
    citizenComplaintId = created.json?.complaint?.id || created.json?.id || created.json?.complaintId || null;
  }

  await hit({ name: 'GET /complaints (unauth)', method: 'GET', url: `${gateway}/complaints`, expected: [401] });
  const list = await hit({
    name: 'GET /complaints',
    method: 'GET',
    url: `${gateway}/complaints?limit=20`,
    headers: bearer(authorityToken),
    expected: [200],
  });
  const listed = asList(list.json, ['complaints', 'items', 'data']);
  const anyComplaintId = citizenComplaintId || firstId(listed[0]);

  await hit({
    name: 'GET /complaints/heatmap/data',
    method: 'GET',
    url: `${gateway}/complaints/heatmap/data`,
    headers: bearer(authorityToken),
    expected: [200, 404],
  });

  if (anyComplaintId) {
    await hit({
      name: 'GET /complaints/:id',
      method: 'GET',
      url: `${gateway}/complaints/${anyComplaintId}`,
      headers: bearer(authorityToken),
      expected: [200],
    });
    await hit({
      name: 'GET /complaints/:id/comments',
      method: 'GET',
      url: `${gateway}/complaints/${anyComplaintId}/comments`,
      headers: bearer(authorityToken),
      expected: [200],
    });
    await hit({
      name: 'POST /complaints/:id/comments',
      method: 'POST',
      url: `${gateway}/complaints/${anyComplaintId}/comments`,
      headers: jsonHeaders(authorityToken),
      body: JSON.stringify({ body: 'Smoke comment from endpoint checker' }),
      expected: [200, 201],
    });
    await hit({
      name: 'POST /complaints/:id/reactions',
      method: 'POST',
      url: `${gateway}/complaints/${anyComplaintId}/reactions`,
      headers: jsonHeaders(authorityToken),
      body: JSON.stringify({ reaction: 'UPVOTE' }),
      expected: [200, 201],
    });
  } else {
    skip('GET /complaints/:id', 'GET', `${gateway}/complaints/:id`, 'no complaint id');
  }

  if (roadId) {
    await hit({
      name: 'POST /complaints (json create)',
      method: 'POST',
      url: `${gateway}/complaints`,
      headers: { ...jsonHeaders(authorityToken), 'Idempotency-Key': `smoke-complaints-${Date.now()}` },
      body: JSON.stringify({
        roadId,
        title: 'Smoke JSON complaint',
        description: 'Pothole reported by endpoint smoke script',
        damageType: 'Potholes & Roads',
        severity: 3,
        lat: roadPoint.lat,
        lng: roadPoint.lng,
        capturedLat: roadPoint.lat,
        capturedLng: roadPoint.lng,
      }),
      expected: [200, 201, 400],
    });
  }

  const authorityCreate = await hit({
    name: 'POST /authority/complaints',
    method: 'POST',
    url: `${gateway}/authority/complaints`,
    headers: { ...jsonHeaders(authorityToken), 'Idempotency-Key': `smoke-auth-${Date.now()}` },
    body: JSON.stringify({
      district: 'New Delhi',
      zone: 'Central',
      description: `[smoke] authority create ${Date.now()}`,
      lat: roadPoint.lat,
      lng: roadPoint.lng,
      severity: 3,
      capturedLat: roadPoint.lat,
      capturedLng: roadPoint.lng,
    }),
    expected: [200, 201],
  });
  const authorityComplaintId = authorityCreate.json?.complaint?.id || anyComplaintId;

  await hit({
    name: 'GET /authority/complaints',
    method: 'GET',
    url: `${gateway}/authority/complaints`,
    headers: bearer(authorityToken),
    expected: [200],
  });
  await hit({
    name: 'GET /authority/analytics',
    method: 'GET',
    url: `${gateway}/authority/analytics`,
    headers: bearer(authorityToken),
    expected: [200],
  });
  await hit({
    name: 'GET /authority/budget',
    method: 'GET',
    url: `${gateway}/authority/budget`,
    headers: bearer(authorityToken),
    expected: [200],
  });
  await hit({
    name: 'GET /authority/audit',
    method: 'GET',
    url: `${gateway}/authority/audit`,
    headers: bearer(authorityToken),
    expected: [200, 403],
  });
  await hit({
    name: 'GET /authority/performance/evaluation',
    method: 'GET',
    url: `${gateway}/authority/performance/evaluation`,
    headers: bearer(authorityToken),
    expected: [200, 403],
  });

  if (authorityComplaintId) {
    await hit({
      name: 'GET /authority/complaints/:id/history',
      method: 'GET',
      url: `${gateway}/authority/complaints/${authorityComplaintId}/history`,
      headers: bearer(authorityToken),
      expected: [200, 404],
    });
    await hit({
      name: 'POST /authority/complaints/:id/sla-warning',
      method: 'POST',
      url: `${gateway}/authority/complaints/${authorityComplaintId}/sla-warning`,
      headers: jsonHeaders(authorityToken),
      body: JSON.stringify({}),
      expected: [200, 400, 404],
    });
    await hit({
      name: 'POST /authority/complaints/:id/escalate',
      method: 'POST',
      url: `${gateway}/authority/complaints/${authorityComplaintId}/escalate`,
      headers: jsonHeaders(authorityToken),
      body: JSON.stringify({ reason: 'smoke escalate' }),
      expected: [200, 400, 404],
    });
    await hit({
      name: 'POST /authority/complaints/:id/status',
      method: 'POST',
      url: `${gateway}/authority/complaints/${authorityComplaintId}/status`,
      headers: jsonHeaders(authorityToken),
      body: JSON.stringify({ status: 'IN_PROGRESS' }),
      expected: [200, 400, 404],
    });
    skip('POST /authority/complaints/:id/resolve', 'POST', `${gateway}/authority/complaints/${authorityComplaintId}/resolve`, 'would close a live complaint');
    skip('POST /authority/complaints/:id/assign', 'POST', `${gateway}/authority/complaints/${authorityComplaintId}/assign`, 'needs a live contractor id');
  }

  const contractorList = await hit({
    name: 'GET /contractor/complaints',
    method: 'GET',
    url: `${gateway}/contractor/complaints`,
    headers: bearer(contractorToken),
    expected: [200, 403],
  });
  const contractorComplaintId = firstId(asList(contractorList.json, ['complaints', 'items'])[0]);
  if (contractorComplaintId) {
    await hit({
      name: 'POST /contractor/complaints/:id/accept',
      method: 'POST',
      url: `${gateway}/contractor/complaints/${contractorComplaintId}/accept`,
      headers: jsonHeaders(contractorToken),
      body: JSON.stringify({}),
      expected: [200, 400, 404],
    });
    await hit({
      name: 'POST /contractor/complaints/:id/progress',
      method: 'POST',
      url: `${gateway}/contractor/complaints/${contractorComplaintId}/progress`,
      headers: jsonHeaders(contractorToken),
      body: JSON.stringify({ progressPct: 40, note: 'Smoke progress update' }),
      expected: [200, 400, 404],
    });
    await hit({
      name: 'POST /contractor/complaints/:id/complete',
      method: 'POST',
      url: `${gateway}/contractor/complaints/${contractorComplaintId}/complete`,
      headers: jsonHeaders(contractorToken),
      body: JSON.stringify({
        report: 'Smoke completion report with photo hash',
        proofUrl: 'https://example.invalid/smoke-proof.jpg',
      }),
      expected: [200, 400, 404],
    });
  } else {
    skip('POST /contractor/complaints/:id/progress', 'POST', `${gateway}/contractor/complaints/:id/progress`, 'no assigned contractor complaints');
  }

  await hit({
    name: 'GET /admin/users',
    method: 'GET',
    url: `${gateway}/admin/users`,
    headers: bearer(authorityToken),
    expected: [200, 403],
  });
  skip('POST /admin/users', 'POST', `${gateway}/admin/users`, 'creates users');
  skip('POST /admin/users/:id/suspend', 'POST', `${gateway}/admin/users/:id/suspend`, 'destructive');

  const rti = await hit({
    name: 'POST /rti',
    method: 'POST',
    url: `${gateway}/rti`,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `smoke-rti-${Date.now()}` },
    body: JSON.stringify({
      countryCode: 'IN',
      authorityName: 'Public Works Department',
      subject: 'Smoke RTI request',
      requestText: 'Please provide status of the smoke-test road repair.',
      status: 'FILED',
    }),
    expected: [200, 201],
  });
  const rtiId = rti.json?.rti?.id || rti.json?.id;
  const rtiToken = rti.json?.rti?.tracking_token || rti.json?.rti?.trackingToken;
  if (rtiId && rtiToken) {
    await hit({
      name: 'GET /rti/:id',
      method: 'GET',
      url: `${gateway}/rti/${encodeURIComponent(rtiId)}?token=${encodeURIComponent(rtiToken)}`,
      expected: [200, 400],
    });
    if (imagePath) {
      const bytes = readFileSync(imagePath);
      const attach = new FormData();
      attach.set('kind', 'PHOTO');
      attach.append('files', new File([bytes], path.basename(imagePath), { type: mimeFor(imagePath) }));
      await hit({
        name: 'POST /rti/:id/attachments (img)',
        method: 'POST',
        url: `${gateway}/rti/${encodeURIComponent(rtiId)}/attachments?token=${encodeURIComponent(rtiToken)}`,
        body: attach,
        expected: [200, 201, 400],
      });
      const responseForm = new FormData();
      responseForm.set('notes', 'Smoke RTI response photo');
      responseForm.set('response', new File([bytes], path.basename(imagePath), { type: mimeFor(imagePath) }));
      await hit({
        name: 'POST /rti/:id/response (img)',
        method: 'POST',
        url: `${gateway}/rti/${encodeURIComponent(rtiId)}/response?token=${encodeURIComponent(rtiToken)}`,
        body: responseForm,
        expected: [200, 201, 400],
      });
    }
    await hit({
      name: 'GET /rti/:id/evidence.zip',
      method: 'GET',
      url: `${gateway}/rti/${encodeURIComponent(rtiId)}/evidence.zip?token=${encodeURIComponent(rtiToken)}`,
      expected: [200, 400, 404],
      parseJson: false,
    });
  }

  await hit({
    name: 'GET /notifications/inbox',
    method: 'GET',
    url: `${gateway}/notifications/inbox`,
    headers: bearer(citizenToken),
    expected: [200],
  });
  await hit({
    name: 'GET /notifications/preferences',
    method: 'GET',
    url: `${gateway}/notifications/preferences`,
    headers: bearer(citizenToken),
    expected: [200],
  });
  await hit({
    name: 'PUT /notifications/preferences',
    method: 'PUT',
    url: `${gateway}/notifications/preferences`,
    headers: jsonHeaders(citizenToken),
    body: JSON.stringify({ enabledChannels: ['IN_APP'] }),
    expected: [200],
  });
  await hit({
    name: 'GET /notifications/topics',
    method: 'GET',
    url: `${gateway}/notifications/topics`,
    headers: bearer(citizenToken),
    expected: [200],
  });

  const districtLabel = districtRow?.name || districtRow?.code || 'New Delhi';
  await hit({
    name: 'GET /reports/district/:districtId.pdf',
    method: 'GET',
    url: `${gateway}/reports/district/${encodeURIComponent(districtLabel)}.pdf`,
    headers: bearer(authorityToken),
    expected: [200, 403],
    parseJson: false,
    timeoutMs: 30000,
  });
  await hit({
    name: 'GET /reports/ministry.pdf',
    method: 'GET',
    url: `${gateway}/reports/ministry.pdf`,
    headers: bearer(authorityToken),
    expected: [200, 403],
    parseJson: false,
    timeoutMs: 30000,
  });

  const serviceToken = envFileValue('INTERNAL_SERVICE_TOKEN') || envFileValue('SERVICE_TOKEN');
  await hit({
    name: 'POST /internal/notifications/create (no token)',
    method: 'POST',
    url: `${gateway}/internal/notifications/create`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'SMOKE',
      title: 'Smoke',
      body: 'internal auth check',
      audience: { kind: 'user', userId: '01900000-0000-7000-8000-00000000c101' },
    }),
    expected: [401],
  });
  if (serviceToken) {
    await hit({
      name: 'POST /internal/notifications/create',
      method: 'POST',
      url: `${gateway}/internal/notifications/create`,
      headers: { 'Content-Type': 'application/json', 'x-service-token': serviceToken },
      body: JSON.stringify({
        type: 'SMOKE',
        title: 'Smoke',
        body: 'internal create',
        audience: { kind: 'user', userId: citizenLogin?.user?.id || '01900000-0000-7000-8000-00000000c101' },
      }),
      expected: [200, 400],
    });
  }

  await hit({
    name: 'GET /events (SSE handshake)',
    method: 'GET',
    url: `${gateway}/events`,
    headers: { ...bearer(authorityToken), Accept: 'text/event-stream' },
    expected: [200],
    parseJson: false,
    timeoutMs: 3000,
  });

  if (citizenComplaintId) {
    await hit({
      name: 'POST /citizen/complaints/:id/confirm',
      method: 'POST',
      url: `${gateway}/citizen/complaints/${citizenComplaintId}/confirm`,
      headers: jsonHeaders(citizenToken),
      body: JSON.stringify({ note: 'smoke confirm' }),
      expected: [200, 400, 403, 404],
    });
    skip(
      'POST /citizen/complaints/:id/dispute',
      'POST',
      `${gateway}/citizen/complaints/${citizenComplaintId}/dispute`,
      'conflicts with confirm on same complaint',
    );
  }

  if (backend) {
    await runBackendChecks({
      backend,
      imagePath,
      roadPoint,
      citizenToken,
      authorityToken,
      citizenLogin,
      authorityLogin,
      anyComplaintId,
    });
  } else {
    skip('backend-api', 'GET', 'http://127.0.0.1:4001/health', 'backend not up (set BACKEND_URL; Kind NodePort is 30401)');
  }

  if (mediaIngest && imagePath) {
    const bytes = readFileSync(imagePath);
    const form = new FormData();
    form.set('file', new File([bytes], path.basename(imagePath), { type: mimeFor(imagePath) }));
    await hit({
      name: 'POST media-ingest /api/uploads/upload (img)',
      method: 'POST',
      url: `${mediaIngest}/api/uploads/upload`,
      body: form,
      expected: [200, 201, 500],
    });
  } else if (!mediaIngest) {
    skip('media-ingest', 'GET', 'http://127.0.0.1:4000/health', 'media-ingest not up');
  }

  await hit({
    name: 'GET /public/export/roads.geojson',
    method: 'GET',
    url: `${gateway}/public/export/roads.geojson`,
    expected: [200],
    parseJson: false,
  });
  await hit({
    name: 'GET /public/export/roads.csv',
    method: 'GET',
    url: `${gateway}/public/export/roads.csv`,
    expected: [200],
    parseJson: false,
  });
  await hit({
    name: 'GET /public/export/roads.pdf',
    method: 'GET',
    url: `${gateway}/public/export/roads.pdf`,
    expected: [200],
    parseJson: false,
    timeoutMs: 30000,
  });

  printSummary();
  process.exit(failCount > 0 ? 1 : 0);
}

async function runBackendChecks({
  backend,
  imagePath,
  roadPoint,
  citizenToken,
  authorityToken,
  citizenLogin,
  authorityLogin,
  anyComplaintId,
}) {
  await hit({ name: 'GET backend /health', method: 'GET', url: `${backend}/health`, expected: [200] });
  await hit({ name: 'GET backend /health/db', method: 'GET', url: `${backend}/health/db`, expected: [200, 503] });

  const userId = citizenLogin?.user?.id || '01900000-0000-7000-8000-00000000c101';
  const sidecar = {
    'X-User-ID': userId,
    'X-User-Role': 'CITIZEN',
    Authorization: `Bearer ${citizenToken}`,
  };
  const nonce = await hit({
    name: 'POST backend /image-submissions/submissions/nonce',
    method: 'POST',
    url: `${backend}/image-submissions/submissions/nonce`,
    headers: { ...sidecar, 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: `smoke-${Date.now()}`, ttl_seconds: 300 }),
    expected: [200, 400, 401, 429],
  });
  if (imagePath && nonce.json?.nonce) {
    const bytes = readFileSync(imagePath);
    const q = new URLSearchParams({
      request_id: `smoke-${Date.now()}`,
      nonce: String(nonce.json.nonce),
      exif_timestamp: String(Date.now()),
      exif_latitude: String(roadPoint.lat),
      exif_longitude: String(roadPoint.lng),
      device_latitude: String(roadPoint.lat),
      device_longitude: String(roadPoint.lng),
      geofence_latitude: String(roadPoint.lat),
      geofence_longitude: String(roadPoint.lng),
      geofence_radius_meters: '80',
    });
    const submitted = await hit({
      name: 'POST backend /image-submissions/submissions (img)',
      method: 'POST',
      url: `${backend}/image-submissions/submissions?${q.toString()}`,
      headers: { ...sidecar, 'Content-Type': 'application/octet-stream' },
      body: bytes,
      expected: [200, 201, 400, 403],
    });
    const submissionId = submitted.json?.id;
    if (submissionId) {
      await hit({
        name: 'GET backend /image-submissions/submissions/:id',
        method: 'GET',
        url: `${backend}/image-submissions/submissions/${submissionId}`,
        headers: sidecar,
        expected: [200, 403],
      });
    }
  } else if (imagePath) {
    skip('POST backend /image-submissions/submissions (img)', 'POST', `${backend}/image-submissions/submissions`, 'nonce not issued');
  }

  const authoritySidecar = {
    'X-User-ID': authorityLogin?.user?.id || '01900000-0000-7000-8000-00000000c001',
    'X-User-Role': 'CE',
    Authorization: `Bearer ${authorityToken}`,
  };
  await hit({
    name: 'GET backend /image-submissions/submissions (authority)',
    method: 'GET',
    url: `${backend}/image-submissions/submissions?limit=10`,
    headers: authoritySidecar,
    expected: [200, 401, 403],
  });
  await hit({
    name: 'GET backend /image-submissions/karma/leaderboard',
    method: 'GET',
    url: `${backend}/image-submissions/karma/leaderboard`,
    headers: authoritySidecar,
    expected: [200, 401, 403],
  });
  await hit({
    name: 'GET backend /image-submissions/karma/:userId',
    method: 'GET',
    url: `${backend}/image-submissions/karma/${encodeURIComponent(userId)}`,
    headers: sidecar,
    expected: [200, 401, 403],
  });
  await hit({
    name: 'POST backend /webhook/fabric-state-change',
    method: 'POST',
    url: `${backend}/webhook/fabric-state-change`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      complaintId: anyComplaintId || '00000000-0000-4000-8000-000000000001',
      eventType: 'complaint-status-changed',
      newStatus: 'Open',
    }),
    expected: [200, 400, 404],
  });
  await hit({
    name: 'POST backend /analytics/collect (no service token)',
    method: 'POST',
    url: `${backend}/analytics/collect`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'smoke', timestamp: Date.now() }),
    expected: [401, 403],
  });
}

function printSummary() {
  console.log('');
  console.log(`Summary: ${passCount} pass, ${failCount} fail, ${skipCount} skip (${results.length} checks)`);
  const imageRows = results.filter((r) => /img|image-submissions|media\/upload|attachments|response|uploads\/upload|heatmap/i.test(r.name));
  if (imageRows.length) {
    console.log('Image-related:');
    for (const r of imageRows) {
      console.log(`  ${r.outcome} ${r.method} ${r.status ?? '-'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
    }
  }
  const failed = results.filter((r) => r.outcome === 'FAIL');
  if (failed.length) {
    console.log('Failures:');
    for (const r of failed) {
      console.log(`  ${r.method} ${r.url} -> ${r.status ?? 'ERR'} ${r.detail}`);
    }
  }
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
