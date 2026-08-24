#!/usr/bin/env node
/**
 * Redis GET cache A/B: measure pg_stat_database.tup_fetched rate
 * with REDIS_READ_CACHE=off then on, using read-only k6 (list + heatmap).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.env.TARGET_URL || 'http://127.0.0.1:30100';
const duration = process.env.SOAK_DURATION || '90s';
const logsDir = path.join(root, 'logs/stress');
mkdirSync(logsDir, { recursive: true });

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

function patchGatewayEnv(pairs) {
  const args = ['-n', 'roadwatch', 'set', 'env', 'deploy/gateway'];
  for (const [key, value] of Object.entries(pairs)) args.push(`${key}=${value}`);
  sh('kubectl', args, { stdio: 'inherit' });
  sh('kubectl', ['-n', 'roadwatch', 'rollout', 'status', 'deploy/gateway', '--timeout=180s'], { stdio: 'inherit' });
  for (let i = 0; i < 30; i++) {
    if (sh('curl', ['-sf', `${target}/health`]).status === 0) return;
    sleep(2000);
  }
  throw new Error(`gateway not healthy after env patch ${JSON.stringify(pairs)}`);
}

function k6(exportRel) {
  return sh('node', [
    'tools/load/stress-platform.mjs',
    '--target', target,
    '--export', exportRel,
    '--tier', 'low',
    '--pattern', 'steady',
    '--duration', duration,
    '--reads-only'
  ], { stdio: 'inherit' });
}

function main() {
  const offStart = tupFetched();
  patchGatewayEnv({ REDIS_READ_CACHE: 'off' });
  sleep(3000);
  const tupOffStart = tupFetched();
  const tOff0 = Date.now();
  k6('logs/stress/k6-summary-cache-off.json');
  const tupOffEnd = tupFetched();
  const elapsedOffSec = Math.max(1, (Date.now() - tOff0) / 1000);
  const dbOffAfter = Number.isFinite(tupOffStart) && Number.isFinite(tupOffEnd)
    ? (tupOffEnd - tupOffStart) / elapsedOffSec
    : null;

  patchGatewayEnv({ REDIS_READ_CACHE: 'on' });
  sleep(3000);
  const cacheBeforeOn = admissionCache();
  const tupOnStart = tupFetched();
  const tOn0 = Date.now();
  k6('logs/stress/k6-summary-cache-on.json');
  const tupOnEnd = tupFetched();
  const elapsedOnSec = Math.max(1, (Date.now() - tOn0) / 1000);
  const dbOnAfter = Number.isFinite(tupOnStart) && Number.isFinite(tupOnEnd)
    ? (tupOnEnd - tupOnStart) / elapsedOnSec
    : null;
  const cacheAfterOn = admissionCache();

  const payload = {
    dbOff: offStart,
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
      : null,
    reductionPct: Number.isFinite(dbOffAfter) && Number.isFinite(dbOnAfter) && dbOffAfter !== 0
      ? ((dbOffAfter - dbOnAfter) / dbOffAfter) * 100
      : null
  };
  writeFileSync(path.join(logsDir, 'cache-ab.json'), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));

  const configPath = path.join(root, 'tools/benchmarks/kind-soak.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.snapshots = {
    ...(config.snapshots || {}),
    dbOff: payload
  };
  config.notes = [
    ...(config.notes || []).filter((n) => !/Postgres exporter|Redis A\/B cache-ab/i.test(n)),
    'Redis GET cache A/B used read-only k6 (list+heatmap) and pg_stat_database.tup_fetched deltas via psql.',
    `tup_fetched/s cache-off=${dbOffAfter} cache-on=${dbOnAfter} reduction=${payload.reductionPct}`
  ];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const report = sh('node', [
    'tools/benchmarks/generate-roadwatch-benchmarks.mjs',
    '--config', 'tools/benchmarks/kind-soak.json',
    '--out', 'docs/operations/benchmarks.md'
  ], { stdio: 'inherit' });
  process.exit(report.status ?? 1);
}

main();
