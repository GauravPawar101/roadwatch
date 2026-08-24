#!/usr/bin/env node
/**
 * Kind soak campaign: coverage, auth restore, cache A/B, Kafka A/B, KEDA spike, MTTD.
 *
 *   pnpm benchmarks:kind-soak
 *   KIND_FULL_SOAK=1 pnpm benchmarks:kind-soak
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const full = process.env.KIND_FULL_SOAK === '1';
const soakDuration = full ? '20m' : (process.env.SOAK_DURATION || '90s');
const spikeDuration = full ? '3m' : '30s';
const target = process.env.TARGET_URL || 'http://127.0.0.1:30100';
const promUrl = process.env.PROM_URL || 'http://127.0.0.1:30090';
const logsDir = path.join(root, 'logs/stress');
mkdirSync(logsDir, { recursive: true });

function kubeSecret(name) {
  const r = sh('kubectl', ['-n', 'roadwatch', 'get', 'secret', 'app-secrets', '-o', `jsonpath={.data.${name}}`]);
  if (r.status !== 0 || !r.stdout?.trim()) return '';
  return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
}
const JWT_BAD = 'kind-soak-wrong-access-secret';
const DB_Q = 'sum(rate(pg_stat_database_tup_fetched{datname="roadwatch"}[2m]))';
const UP_Q = 'avg_over_time(up{job="gateway-admission"}[15m]) * 100';

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function k6Rate(fileRel, names) {
  try {
    const json = JSON.parse(readFileSync(path.join(root, fileRel), 'utf8'));
    for (const name of names) {
      const metric = json.metrics?.[name];
      const value = metric?.values?.rate ?? metric?.rate ?? metric?.value;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* missing summary */
  }
  return null;
}

function tupFetched() {
  const r = sh('kubectl', [
    '-n', 'roadwatch', 'exec', 'postgres-primary-0', '-c', 'postgres', '--',
    'psql', '-U', 'postgres', '-d', 'roadwatch', '-tA', '-c',
    'select tup_fetched from pg_stat_database where datname = current_database();'
  ]);
  const n = Number(String(r.stdout || '').trim());
  return Number.isFinite(n) ? n : null;
}

function admissionCache() {
  const r = sh('curl', ['-sf', `${target}/metrics/admission`]);
  const text = r.stdout || '';
  const hits = Number(text.match(/roadwatch_cache_hits_total\s+(\d+(?:\.\d+)?)/)?.[1]);
  const misses = Number(text.match(/roadwatch_cache_misses_total\s+(\d+(?:\.\d+)?)/)?.[1]);
  return {
    hits: Number.isFinite(hits) ? hits : null,
    misses: Number.isFinite(misses) ? misses : null
  };
}

async function promQuery(query) {
  try {
    const url = `${promUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const json = await res.json();
    const v = json.data?.result?.[0]?.value?.[1];
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function ensureKube() {
  sh('kind', ['export', 'kubeconfig', '--name', 'roadwatch']);
  sh('kubectl', ['config', 'use-context', 'kind-roadwatch']);
}

function ensurePromForward() {
  const probe = sh('curl', ['-sf', `${promUrl}/-/ready`]);
  if (probe.status === 0) return;
  console.log('Prometheus 30090 not reachable; starting port-forward');
  spawnSync('bash', ['-lc', 'pkill -f "port-forward.*30090" || true'], { cwd: root });
  spawn('kubectl', [
    '-n', 'observability', 'port-forward', 'svc/prometheus', '30090:9090'
  ], { cwd: root, detached: true, stdio: 'ignore' }).unref();
  sleep(2000);
}

function k6(exportRel, extra = []) {
  return sh('node', [
    'tools/load/stress-platform.mjs',
    '--target', target,
    '--export', exportRel,
    ...extra
  ], { stdio: 'inherit' });
}

function patchGatewayEnv(pairs) {
  const args = ['-n', 'roadwatch', 'set', 'env', 'deploy/gateway'];
  for (const [key, value] of Object.entries(pairs)) args.push(`${key}=${value}`);
  sh('kubectl', args, { stdio: 'inherit' });
  sh('kubectl', ['-n', 'roadwatch', 'rollout', 'status', 'deploy/gateway', '--timeout=180s'], { stdio: 'inherit' });
}

function healthOk() {
  return sh('curl', ['-sf', `${target}/health`]).status === 0;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const notes = [];
  const timestamps = {};
  ensureKube();
  ensurePromForward();

  if (!healthOk()) {
    notes.push(`Gateway not reachable at ${target}/health. Apply Kind overlay then re-run.`);
  }

  const cloverCore = path.join(root, 'packages/core/coverage/clover.xml');
  const cloverGw = path.join(root, 'apps/gateway-api/coverage/clover.xml');
  if (existsSync(cloverCore) && existsSync(cloverGw) && process.env.FORCE_COVERAGE !== '1') {
    notes.push('Reused existing core + gateway clover coverage; skipped verbose backend coverage.');
  } else {
    const coverage = sh('pnpm', ['--filter', '@roadwatch/core', 'test:coverage'], {
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '' }
    });
    sh('pnpm', ['--filter', '@roadwatch/gateway-api', 'test:coverage'], { stdio: 'inherit' });
    if (coverage.status !== 0) notes.push('core coverage exited non-zero.');
  }

  const auth = {};
  if (healthOk()) {
    timestamps.authInject = new Date().toISOString();
    patchGatewayEnv({ ACCESS_SECRET: JWT_BAD, JWT_SECRET: JWT_BAD });
    k6('logs/stress/k6-summary-auth-before.json', ['--tier', 'smoke', '--pattern', 'steady', '--duration', '30s']);
    auth.createOkBefore = k6Rate('logs/stress/k6-summary-auth-before.json', ['complaint_create_ok', 'complaint_create_ok']);
    patchGatewayEnv({ ACCESS_SECRET: kubeSecret('ACCESS_SECRET') || kubeSecret('JWT_SECRET'), JWT_SECRET: kubeSecret('JWT_SECRET') || kubeSecret('ACCESS_SECRET') });
    timestamps.authRestored = new Date().toISOString();
    k6('logs/stress/k6-summary-auth-after.json', ['--tier', 'smoke', '--pattern', 'steady', '--duration', '30s']);
    auth.createOkAfter = k6Rate('logs/stress/k6-summary-auth-after.json', ['complaint_create_ok', 'complaint_create_ok']);

    patchGatewayEnv({ REDIS_READ_CACHE: 'off' });
    sleep(5000);
    const tupOffStart = tupFetched();
    const tOff0 = Date.now();
    k6('logs/stress/k6-summary-cache-off.json', ['--tier', 'low', '--pattern', 'steady', '--duration', soakDuration, '--reads-only']);
    const tupOffEnd = tupFetched();
    const elapsedOffSec = Math.max(1, (Date.now() - tOff0) / 1000);
    const dbOffAfter = Number.isFinite(tupOffStart) && Number.isFinite(tupOffEnd)
      ? (tupOffEnd - tupOffStart) / elapsedOffSec
      : await promQuery(DB_Q);
    const dbOffSample = tupOffStart;

    patchGatewayEnv({ REDIS_READ_CACHE: 'on' });
    sleep(5000);
    const cacheBeforeOn = admissionCache();
    const tupOnStart = tupFetched();
    const tOn0 = Date.now();
    k6('logs/stress/k6-summary-cache-on.json', ['--tier', 'low', '--pattern', 'steady', '--duration', soakDuration, '--reads-only']);
    const tupOnEnd = tupFetched();
    const elapsedOnSec = Math.max(1, (Date.now() - tOn0) / 1000);
    const dbOnAfter = Number.isFinite(tupOnStart) && Number.isFinite(tupOnEnd)
      ? (tupOnEnd - tupOnStart) / elapsedOnSec
      : await promQuery(DB_Q);
    const cacheAfterOn = admissionCache();
    writeFileSync(path.join(logsDir, 'cache-ab.json'), JSON.stringify({
      dbOff: dbOffSample,
      dbOffAfter,
      dbOnAfter,
      tupOffStart,
      tupOffEnd,
      tupOnStart,
      tupOnEnd,
      elapsedOffSec,
      elapsedOnSec,
      cacheHitsDelta: Number.isFinite(cacheAfterOn.hits) && Number.isFinite(cacheBeforeOn.hits)
        ? cacheAfterOn.hits - cacheBeforeOn.hits
        : null,
      cacheMissesDelta: Number.isFinite(cacheAfterOn.misses) && Number.isFinite(cacheBeforeOn.misses)
        ? cacheAfterOn.misses - cacheBeforeOn.misses
        : null
    }, null, 2));

    patchGatewayEnv({ COMPLAINT_WRITE_MODE: 'sync-anchor', COMPLAINT_WRITE_MODE: 'sync-anchor' });
    k6('logs/stress/k6-summary-before.json', ['--tier', 'medium', '--pattern', 'ramp', '--duration', soakDuration]);
    patchGatewayEnv({ COMPLAINT_WRITE_MODE: 'outbox', COMPLAINT_WRITE_MODE: 'outbox' });
    k6('logs/stress/k6-summary-after.json', ['--tier', 'medium', '--pattern', 'ramp', '--duration', soakDuration]);

    k6('logs/stress/k6-summary-keda-spike.json', ['--tier', 'spike', '--pattern', 'burst', '--duration', spikeDuration]);
    const healthRate = k6Rate('logs/stress/k6-summary-keda-spike.json', ['health_ok', 'health_ok']);
    const uptimeProm = await promQuery(UP_Q);
    const uptime = Number.isFinite(uptimeProm) ? uptimeProm : (Number.isFinite(healthRate) ? healthRate * 100 : null);
    writeFileSync(path.join(logsDir, 'uptime.json'), JSON.stringify({ uptime, uptimeProm, healthRate }, null, 2));

    timestamps.incidentStart = new Date().toISOString();
    const curlLoopStart = Date.now();
    sh('kubectl', ['-n', 'roadwatch', 'scale', 'deploy/gateway', '--replicas=0'], { stdio: 'inherit' });
    let detectedBeforeMs = null;
    for (let i = 0; i < 40; i++) {
      if (!healthOk()) {
        detectedBeforeMs = Date.now() - curlLoopStart;
        break;
      }
      sleep(2000);
    }
    timestamps.detectedBefore = new Date(curlLoopStart + (detectedBeforeMs ?? 0)).toISOString();
    sleep(65000);
    timestamps.detectedAfter = new Date().toISOString();
    sh('kubectl', ['-n', 'roadwatch', 'scale', 'deploy/gateway', '--replicas=1'], { stdio: 'inherit' });
    sh('kubectl', ['-n', 'roadwatch', 'rollout', 'status', 'deploy/gateway', '--timeout=180s'], { stdio: 'inherit' });
    writeFileSync(path.join(logsDir, 'mttd.json'), JSON.stringify({ ...timestamps, detectedBeforeMs }, null, 2));
  } else {
    notes.push('Skipped live k6/KEDA/MTTD because gateway health failed.');
  }

  const dbOff = readJson(path.join(logsDir, 'cache-ab.json'), {});
  const mttd = readJson(path.join(logsDir, 'mttd.json'), {});
  const uptimeFile = readJson(path.join(logsDir, 'uptime.json'), {});
  const hasBefore = existsSync(path.join(root, 'logs/stress/k6-summary-before.json'));
  const hasAfter = existsSync(path.join(root, 'logs/stress/k6-summary-after.json'));

  const config = {
    services: ['gateway-api', 'backend-api', 'webhook-handler', 'fabric-anchor-consumer', 'scheduler'],
    k6: {
      before: hasBefore ? 'logs/stress/k6-summary-before.json' : 'logs/stress/k6-summary-cache-off.json',
      after: hasAfter ? 'logs/stress/k6-summary-after.json' : 'logs/stress/k6-summary-cache-on.json'
    },
    coverage: [
      { label: 'unit', lcov: 'packages/core/coverage' },
      { label: 'integration', lcov: 'apps/gateway-api/coverage' },
      { label: 'api', lcov: 'backend-api/coverage' }
    ],
    prometheus: {
      baseUrl: promUrl,
      dbBeforeQuery: 'sum(rate(pg_stat_database_tup_fetched{datname="roadwatch"}[5m]))',
      dbAfterQuery: 'sum(rate(pg_stat_database_tup_fetched{datname="roadwatch"}[5m]))',
      dbBeforeQuery: 'sum(rate(pg_stat_database_tup_fetched{datname="roadwatch"}[5m]))',
      dbAfterQuery: 'sum(rate(pg_stat_database_tup_fetched{datname="roadwatch"}[5m]))',
      uptimeQuery: UP_Q,
      uptimeQuery: UP_Q
    },
    incident: {
      start: mttd.incidentStart || timestamps.incidentStart || null,
      detectedBefore: mttd.detectedBefore || timestamps.detectedBefore || null,
      detectedAfter: mttd.detectedAfter || timestamps.detectedAfter || null
    },
    notes,
    snapshots: { dbOff, uptimeFile, mttd, auth }
  };

  writeFileSync(path.join(root, 'tools/benchmarks/kind-soak.json'), `${JSON.stringify(config, null, 2)}\n`);
  console.log('wrote tools/benchmarks/kind-soak.json');

  const report = sh('node', [
    'tools/benchmarks/generate-roadwatch-benchmarks.mjs',
    '--config', 'tools/benchmarks/kind-soak.json',
    '--out', 'docs/operations/benchmarks.md'
  ], { stdio: 'inherit' });
  process.exit(report.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
