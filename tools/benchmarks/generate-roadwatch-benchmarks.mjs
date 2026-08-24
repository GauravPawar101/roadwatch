#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

function usage() {
  return `
Usage:
  node tools/benchmarks/generate-roadwatch-benchmarks.mjs --config benchmarks.json [--out README-benchmarks.md]

If the config path is not found as given, the script also checks tools/benchmarks/<basename>.

Config shape:
  {
    "services": ["gateway-api", "backend-api", "webhook-handler"],
    "k6": {
      "before": "logs/stress/k6-summary-before.json",
      "after": "logs/stress/k6-summary-after.json"
    },
    "coverage": [
      { "label": "unit", "lcov": "packages/core/coverage/lcov.info" },
      { "label": "integration", "lcov": "apps/gateway-api/coverage/lcov.info" }
    ],
    "prometheus": {
      "baseUrl": "http://localhost:9090",
      "dbBeforeQuery": "sum(pg_stat_activity_count)",
      "dbAfterQuery": "sum(pg_stat_activity_count)",
      "uptimeQuery": "avg_over_time(up{job='gateway'}[1h]) * 100",
      "trafficBeforeQuery": "...",
      "trafficAfterQuery": "..."
    },
    "incident": {
      "start": "2026-08-24T10:00:00Z",
      "detectedBefore": "2026-08-24T10:18:00Z",
      "detectedAfter": "2026-08-24T10:05:00Z"
    }
  }
`;
}

function parseArgs(argv) {
  const out = { coverage: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--config' && next) {
      out.config = next;
      i++;
    } else if (arg === '--out' && next) {
      out.out = next;
      i++;
    } else if (arg === '--services' && next) {
      out.services = next;
      i++;
    } else if (arg === '--k6-before' && next) {
      out.k6Before = next;
      i++;
    } else if (arg === '--k6-after' && next) {
      out.k6After = next;
      i++;
    } else if (arg === '--coverage' && next) {
      out.coverage.push(next);
      i++;
    } else if (arg === '--prom-url' && next) {
      out.prometheus = out.prometheus || {};
      out.prometheus.baseUrl = next;
      i++;
    } else if (arg === '--db-before-query' && next) {
      out.prometheus = out.prometheus || {};
      out.prometheus.dbBeforeQuery = next;
      i++;
    } else if (arg === '--db-after-query' && next) {
      out.prometheus = out.prometheus || {};
      out.prometheus.dbAfterQuery = next;
      i++;
    } else if (arg === '--uptime-query' && next) {
      out.prometheus = out.prometheus || {};
      out.prometheus.uptimeQuery = next;
      i++;
    } else if (arg === '--traffic-before-query' && next) {
      out.prometheus = out.prometheus || {};
      out.prometheus.trafficBeforeQuery = next;
      i++;
    } else if (arg === '--traffic-after-query' && next) {
      out.prometheus = out.prometheus || {};
      out.prometheus.trafficAfterQuery = next;
      i++;
    } else if (arg === '--incident-start' && next) {
      out.incident = out.incident || {};
      out.incident.start = next;
      i++;
    } else if (arg === '--detected-before' && next) {
      out.incident = out.incident || {};
      out.incident.detectedBefore = next;
      i++;
    } else if (arg === '--detected-after' && next) {
      out.incident = out.incident || {};
      out.incident.detectedAfter = next;
      i++;
    }
  }
  return out;
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = key in merged ? deepMerge(merged[key], value) : value;
    }
    return merged;
  }
  return override ?? base;
}

function asArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function normalizeServices(value) {
  return asArray(value).flatMap((entry) => {
    if (typeof entry === 'string') {
      return entry.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
  });
}

function formatInteger(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value) : 'n/a';
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : 'n/a';
}

function formatPercent(value, digits = 2) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : 'n/a';
}

function formatDurationMinutes(ms) {
  return Number.isFinite(ms) ? `${formatNumber(ms / 60000, 2)} min` : 'n/a';
}

function firstFinite(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function k6Metric(summary, names, key) {
  for (const name of asArray(names)) {
    const value = metricValue(summary, name, key);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  if (String(value).includes('<')) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function metricValue(summary, name, key = 'count') {
  const metric = summary?.metrics?.[name];
  if (!metric) return null;
  if (key === 'rate') {
    return firstFinite(metric.values?.rate, metric.rate, metric.value);
  }
  if (metric.values && key in metric.values) {
    return metric.values[key];
  }
  return metric[key] ?? metric.values?.[key] ?? null;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function resolveInputPath(inputPath) {
  const resolved = path.resolve(inputPath);
  if (existsSync(resolved)) {
    return resolved;
  }

  const fallback = path.resolve('tools/benchmarks', path.basename(inputPath));
  if (existsSync(fallback)) {
    return fallback;
  }

  return resolved;
}

async function loadK6Summary(filePath) {
  const resolved = resolveInputPath(filePath);
  if (!existsSync(resolved)) {
    return null;
  }
  return readJson(resolved);
}

async function findLcovFiles(inputPath) {
  const resolved = resolveInputPath(inputPath);
  if (!existsSync(resolved)) {
    return [];
  }
  const stats = await stat(resolved);
  if (stats.isFile()) {
    return [resolved];
  }

  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(next);
      } else if (entry.isFile() && (entry.name === 'lcov.info' || entry.name === 'clover.xml')) {
        found.push(next);
      }
    }
  }

  await walk(resolved);
  if (found.length === 0) {
    return [];
  }
  return found;
}

async function readCoverageFromLcov(filePath) {
  if (filePath.endsWith('clover.xml')) {
    const xml = await readFile(filePath, 'utf8');
    const metrics = xml.match(/<metrics[^>]*\/>/)?.[0] ?? xml.match(/<metrics[^>]*>/)?.[0] ?? '';
    const found = Number(metrics.match(/statements="(\d+)"/)?.[1] ?? 0);
    const hit = Number(metrics.match(/coveredstatements="(\d+)"/)?.[1] ?? 0);
    return { linesFound: found, linesHit: hit, coverage: found > 0 ? (hit / found) * 100 : null };
  }
  const text = await readFile(filePath, 'utf8');
  let linesFound = 0;
  let linesHit = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('LF:')) {
      linesFound += Number(line.slice(3)) || 0;
    } else if (line.startsWith('LH:')) {
      linesHit += Number(line.slice(3)) || 0;
    }
  }
  return { linesFound, linesHit, coverage: linesFound > 0 ? (linesHit / linesFound) * 100 : null };
}

async function queryPrometheus(baseUrl, query) {
  if (typeof query !== 'string' || !query.trim() || query.trim().startsWith('<')) {
    return null;
  }
  const url = new URL('/api/v1/query', baseUrl);
  url.searchParams.set('query', query);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (payload.status !== 'success') {
      return null;
    }
    const result = payload.data?.result ?? [];
    if (result.length === 0) {
      return null;
    }
    const value = result[0]?.value?.[1];
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

function renderSources(config) {
  const lines = [];
  if (config.k6?.before) lines.push(`- k6 before: ${path.resolve(config.k6.before)}`);
  if (config.k6?.after) lines.push(`- k6 after: ${path.resolve(config.k6.after)}`);
  for (const source of asArray(config.coverage)) {
    if (source?.lcov) lines.push(`- coverage ${source.label ?? path.basename(path.dirname(source.lcov))}: ${path.resolve(source.lcov)}`);
  }
  if (config.prometheus?.baseUrl) lines.push(`- Prometheus: ${config.prometheus.baseUrl}`);
  if (config.incident?.start) lines.push(`- incident start: ${config.incident.start}`);
  if (config.incident?.detectedBefore) lines.push(`- incident detection before: ${config.incident.detectedBefore}`);
  if (config.incident?.detectedAfter) lines.push(`- incident detection after: ${config.incident.detectedAfter}`);
  return lines;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage().trim());
    return;
  }

  let config = {};
  if (cli.config) {
    config = await readJson(resolveInputPath(cli.config));
  }

  config = deepMerge(config, {
    services: cli.services,
    k6: { before: cli.k6Before, after: cli.k6After },
    coverage: cli.coverage.length ? cli.coverage.map((entry) => ({ lcov: entry })) : undefined,
    prometheus: cli.prometheus,
    incident: cli.incident,
  });

  const services = normalizeServices(config.services);
  const k6BeforePath = config.k6?.before ? path.resolve(config.k6.before) : null;
  const k6AfterPath = config.k6?.after ? path.resolve(config.k6.after) : null;
  const primaryK6Path = k6AfterPath ?? k6BeforePath;
  if (!primaryK6Path) {
    throw new Error('Provide at least one k6 summary path in config.k6.before or config.k6.after.');
  }

  const primaryK6 = await loadK6Summary(primaryK6Path);
  const k6Before = k6BeforePath ? await loadK6Summary(k6BeforePath) : null;
  const k6After = k6AfterPath ? await loadK6Summary(k6AfterPath) : null;
  const requestsPerSecond = firstFinite(
    k6Metric(primaryK6, ['http_reqs', 'http_reqs'], 'rate')
  );
  const requestsPerDay = Number.isFinite(requestsPerSecond) ? requestsPerSecond * 86400 : null;
  const p95Before = firstFinite(
    k6Metric(k6Before, 'http_req_duration', 'p(95)'),
    k6Metric(k6Before, 'http_req_duration', 'p95')
  );
  const p95After = firstFinite(
    k6Metric(k6After, 'http_req_duration', 'p(95)'),
    k6Metric(k6After, 'http_req_duration', 'p95')
  );

  const coverageInputs = asArray(config.coverage);
  const coverageParts = [];
  let coverageHits = 0;
  let coverageFound = 0;
  for (const input of coverageInputs) {
    if (!input?.lcov) continue;
    const files = await findLcovFiles(input.lcov);
    for (const file of files) {
      const stats = await readCoverageFromLcov(file);
      coverageHits += stats.linesHit;
      coverageFound += stats.linesFound;
      coverageParts.push({
        label: input.label ?? path.basename(path.dirname(file)),
        file,
        coverage: stats.coverage,
        linesHit: stats.linesHit,
        linesFound: stats.linesFound,
      });
    }
  }
  const coveragePercent = coverageFound > 0 ? (coverageHits / coverageFound) * 100 : null;

  const prom = config.prometheus ?? {};
  const promBaseUrl = prom.baseUrl;
  const dbBeforeQuery = prom.dbBeforeQuery ?? prom.dbBeforeQuery;
  const dbAfterQuery = prom.dbAfterQuery ?? prom.dbAfterQuery;
  const uptimeQuery = prom.uptimeQuery ?? prom.uptimeQuery;
  const snap = config.snapshots ?? {};
  const authBeforeK6 = await loadK6Summary(path.resolve('logs/stress/k6-summary-auth-before.json'));
  const authAfterK6 = await loadK6Summary(path.resolve('logs/stress/k6-summary-auth-after.json'));
  const kedaK6 = await loadK6Summary(path.resolve('logs/stress/k6-summary-keda-spike.json'));

  const dbBefore = firstFinite(
    snap.dbOff?.dbOffAfter,
    snap.dbOff?.dbOff,
    dbBeforeQuery && promBaseUrl ? await queryPrometheus(promBaseUrl, dbBeforeQuery) : null
  );
  const dbAfter = firstFinite(
    snap.dbOff?.dbOnAfter,
    dbAfterQuery && promBaseUrl ? await queryPrometheus(promBaseUrl, dbAfterQuery) : null
  );
  const dbReduction = Number.isFinite(dbBefore) && Number.isFinite(dbAfter) && dbBefore !== 0
    ? ((dbBefore - dbAfter) / dbBefore) * 100
    : null;
  const k6Health = firstFinite(
    k6Metric(kedaK6, ['health_ok', 'health_ok'], 'rate'),
    k6Metric(k6After, ['health_ok', 'health_ok'], 'rate')
  );
  const uptime = firstFinite(
    snap.uptimeFile?.uptime,
    k6Health != null ? k6Health * 100 : null,
    uptimeQuery && promBaseUrl ? await queryPrometheus(promBaseUrl, uptimeQuery) : null
  );
  const trafficBefore = firstFinite(
    snap.auth?.createOkBefore,
    k6Metric(authBeforeK6, ['complaint_create_ok', 'complaint_create_ok'], 'rate')
  );
  const trafficAfter = firstFinite(
    snap.auth?.createOkAfter,
    k6Metric(authAfterK6, ['complaint_create_ok', 'complaint_create_ok'], 'rate')
  );
  const trafficRestored = Number.isFinite(trafficBefore) && Number.isFinite(trafficAfter) && trafficBefore !== 0
    ? (trafficAfter / trafficBefore) * 100
    : (Number.isFinite(trafficBefore) && Number.isFinite(trafficAfter) && trafficBefore === 0 && trafficAfter > 0 ? 100 : null);

  const incidentStart = parseTimestamp(config.incident?.start);
  const detectedBefore = parseTimestamp(config.incident?.detectedBefore);
  const detectedAfter = parseTimestamp(config.incident?.detectedAfter);
  const detectBeforeMs = incidentStart != null && detectedBefore != null ? detectedBefore - incidentStart : null;
  const detectAfterMs = incidentStart != null && detectedAfter != null ? detectedAfter - incidentStart : null;

  const report = [
    '# RoadWatch Benchmark Report',
    '',
    'Generated from real measurement artifacts only. Missing values stay `n/a` instead of being estimated.',
    '',
    '## Sources',
    ...renderSources(config),
    '',
    '## Metrics',
    '',
    '| Benchmark | Actual data | Evidence |',
    '| --- | --- | --- |',
    `| Requests/day or requests/sec + N services | ${formatNumber(requestsPerSecond, 2)} req/s (${formatInteger(requestsPerDay)} req/day soak-equivalent), N=${services.length || 'n/a'} | k6 summary ${primaryK6Path} |`,
    `| p95 API response time, before vs after Kafka decoupling | before: ${formatNumber(p95Before, 2)} ms; after: ${formatNumber(p95After, 2)} ms | k6 summaries ${k6BeforePath ?? 'n/a'} / ${k6AfterPath ?? 'n/a'} |`,
    `| % database load reduction from Redis caching | ${formatPercent(dbReduction, 2)} (before: ${formatNumber(dbBefore, 2)}, after: ${formatNumber(dbAfter, 2)}) | cache A/B snapshots + Prometheus ${dbBeforeQuery ?? 'n/a'} |`,
    `| Uptime % under load from KEDA autoscaling test | ${formatPercent(uptime, 2)} | k6 health_ok and Prometheus ${uptimeQuery ?? 'n/a'} |`,
    `| Test coverage % (unit + integration) | ${formatPercent(coveragePercent, 2)} | ${coverageParts.map((part) => `${part.label}: ${part.file}`).join(' ; ') || 'n/a'} |`,
    `| % traffic restored after fixing the auth bug | ${formatPercent(trafficRestored, 2)} (before: ${formatNumber(trafficBefore, 2)}, after: ${formatNumber(trafficAfter, 2)}) | k6 complaint_create_ok auth-before/after |`,
    `| Incident detection time, before vs after Grafana/Prometheus | before: ${formatDurationMinutes(detectBeforeMs)}; after: ${formatDurationMinutes(detectAfterMs)} | ${config.incident?.start ?? 'n/a'} / ${config.incident?.detectedBefore ?? 'n/a'} / ${config.incident?.detectedAfter ?? 'n/a'} |`,
    '',
    ...(asArray(config.notes).length
      ? ['## Notes', '', ...asArray(config.notes).map((note) => `- ${note}`), '']
      : []),
  ].join('\n');

  if (cli.out) {
    const outPath = path.resolve(cli.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, report);
    console.log(outPath);
  } else {
    process.stdout.write(report);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});