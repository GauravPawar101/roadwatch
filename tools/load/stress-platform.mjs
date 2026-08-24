#!/usr/bin/env node
/**
 * Platform stress harness — 20m default soak across traffic tiers/patterns.
 *
 * Usage:
 *   node tools/load/stress-platform.mjs
 *   node tools/load/stress-platform.mjs --tier medium --pattern ramp --duration 20m
 *   pnpm stress:platform -- --tier high --pattern burst --duration 20m
 *
 * Tiers: smoke | low | medium | high | spike
 * Patterns: steady | ramp | burst | wave
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const scriptPath = path.join(repoRoot, 'tests/load/k6/platform-stress.js');
const logsDir = path.join(repoRoot, 'logs/stress');

function parseArgs(argv) {
  const out = {
    tier: process.env.STRESS_TIER || 'medium',
    pattern: process.env.STRESS_PATTERN || 'ramp',
    duration: process.env.STRESS_DURATION || '20m',
    target: process.env.TARGET_URL || 'http://127.0.0.1:30100',
    jwtSecret: process.env.JWT_SECRET || process.env.ACCESS_SECRET || '',
    exportPath: process.env.K6_SUMMARY_EXPORT || '',
    readsOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    const next = argv[i + 1];
    if (a === '--tier' && next) { out.tier = next; i++; }
    else if (a === '--pattern' && next) { out.pattern = next; i++; }
    else if (a === '--duration' && next) { out.duration = next; i++; }
    else if (a === '--target' && next) { out.target = next; i++; }
    else if ((a === '--export' || a === '--summary-export') && next) { out.exportPath = next; i++; }
    else if (a === '--reads-only') { out.readsOnly = true; }
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function loadJwtSecret(cliSecret) {
  if (cliSecret) return cliSecret;
  // Gateway jwt.ts uses (ACCESS_SECRET || JWT_SECRET). Zod always supplies an ACCESS_SECRET
  // default, so a lone JWT_SECRET in .env / process.env does NOT affect access-token verify.
  if (process.env.ACCESS_SECRET) return process.env.ACCESS_SECRET;
  const envPath = path.join(repoRoot, 'apps/gateway-api/.env');
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8');
    const access = text.match(/^ACCESS_SECRET=(.+)$/m);
    if (access) return access[1].trim().replace(/^["']|["']$/g, '');
  }
  const kube = spawnSync(
    'kubectl',
    ['get', 'secret', 'app-secrets', '-n', 'roadwatch', '-o', 'jsonpath={.data.ACCESS_SECRET}'],
    { encoding: 'utf8' }
  );
  if (kube.status === 0 && kube.stdout?.trim()) {
    return Buffer.from(kube.stdout.trim(), 'base64').toString('utf8');
  }
  return 'roadwatch-local-dev-jwt-secret-replace-in-production';
}

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function dockerProbe() {
  const probes = {};
  const ps = sh('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}']);
  probes.containers = (ps.stdout || '')
    .split('\n')
    .filter(Boolean)
    .filter((line) => /roadwatch_|kafka|fabric|scheduler|webhook|postgres|redis/i.test(line));

  for (const name of ['roadwatch_kafka_hlf', 'roadwatch_kafka_events', 'roadwatch_fabric_anchor_consumer', 'roadwatch_webhook_handler', 'roadwatch_scheduler']) {
    const logs = sh('docker', ['logs', name, '--tail', '30'], { timeout: 15000 });
    probes[`${name}_tail`] = ((logs.stdout || '') + (logs.stderr || '')).slice(-2500);
  }

  // Consumer group lag (best-effort)
  for (const [label, container, group] of [
    ['hlf', 'roadwatch_kafka_hlf', 'fabric-anchor-consumer-prod'],
    ['events', 'roadwatch_kafka_events', 'webhook-handler-prod'],
  ]) {
    const lag = sh('docker', [
      'exec', container,
      'kafka-consumer-groups',
      '--bootstrap-server', 'localhost:29092',
      '--describe',
      '--group', group,
    ], { timeout: 20000 });
    probes[`lag_${label}`] = ((lag.stdout || '') + (lag.stderr || '')).slice(0, 2000);
  }

  return probes;
}

function suggestActions({ failRate, p95, probes }) {
  const actions = [];
  if (failRate > 0.05) {
    actions.push('API error rate >5%: check gateway logs, JWT_SECRET mismatch, and DB pool saturation via PgBouncer.');
  }
  if (p95 > 3000) {
    actions.push('p95 latency >3s: scale gateway/backend (HPA in k8s), raise PgBouncer DEFAULT_POOL_SIZE, or reduce write fan-out.');
  }
  const fabricTail = probes.roadwatch_fabric_anchor_consumer_tail || '';
  if (/flush failed|FAILED_PRECONDITION|endorsement/i.test(fabricTail)) {
    actions.push('Fabric flush errors: verify chaincode is committed, peer endorsements, and FABRIC_* cert mounts.');
  }
  if (/Restarting|crash|ERR_MODULE/i.test(fabricTail)) {
    actions.push('fabric-anchor-consumer unstable: inspect image node_modules packaging and Kafka group join.');
  }
  const hlfLag = probes.lag_hlf || '';
  if (/LAG|lag/i.test(hlfLag) && /\s[1-9]\d{2,}\s/.test(hlfLag)) {
    actions.push('HLF Kafka lag high: raise fabric-anchor replicas / batch size, or add partitions on complaint-submitted.');
  }
  if (actions.length === 0) {
    actions.push('No hard failure signatures detected. Re-run with --tier high --pattern burst to find the cliff.');
  }
  return actions;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node tools/load/stress-platform.mjs [--tier smoke|low|medium|high|spike] [--pattern steady|ramp|burst|wave] [--duration 20m] [--target http://127.0.0.1:30100] [--export logs/stress/k6-summary-after.json]`);
    process.exit(0);
  }
  if (!existsSync(scriptPath)) {
    console.error(`[stress] Missing k6 script: ${scriptPath}`);
    process.exit(1);
  }

  mkdirSync(logsDir, { recursive: true });
  // k6 image runs as non-root; ensure it can write summary JSON.
  try {
    sh('chmod', ['777', logsDir]);
  } catch {
    /* best-effort */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summaryHost = path.join(logsDir, `k6-summary-${stamp}.json`);
  const reportHost = path.join(logsDir, `report-${stamp}.md`);
  const jwtSecret = loadJwtSecret(args.jwtSecret);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 0;

  console.log(`[stress] tier=${args.tier} pattern=${args.pattern} duration=${args.duration} target=${args.target}`);
  console.log(`[stress] access-token secret length=${jwtSecret.length}`);

  const pre = dockerProbe();

  const dockerArgs = [
    'run', '--rm',
    '--network', 'host',
    '--user', `${uid}:${gid}`,
    '-e', `TARGET_URL=${args.target}`,
    '-e', `JWT_SECRET=${jwtSecret}`,
    '-e', `STRESS_TIER=${args.tier}`,
    '-e', `STRESS_PATTERN=${args.pattern}`,
    '-e', `STRESS_DURATION=${args.duration}`,
    '-e', `READS_ONLY=${args.readsOnly ? '1' : '0'}`,
    '-v', `${repoRoot}:/work`,
    '-w', '/work',
    'grafana/k6:latest',
    'run',
    '--summary-export', `/work/logs/stress/k6-summary-${stamp}.json`,
    '/work/tests/load/k6/platform-stress.js',
  ];

  const started = Date.now();
  const res = sh('docker', dockerArgs, { stdio: 'inherit', timeout: 480000, killSignal: 'SIGKILL' });
  const elapsedMs = Date.now() - started;
  const post = dockerProbe();

  let metrics = {};
  if (existsSync(summaryHost)) {
    try {
      metrics = JSON.parse(readFileSync(summaryHost, 'utf8'));
    } catch {
      metrics = {};
    }
  }

  const failRate = metrics.metrics?.http_req_failed?.value
    ?? metrics.metrics?.http_req_failed?.values?.rate;
  const p95 = metrics.metrics?.http_req_duration?.['p(95)']
    ?? metrics.metrics?.http_req_duration?.values?.['p(95)'];
  const createRate = metrics.metrics?.complaint_create_ok?.value
    ?? metrics.metrics?.complaint_create_ok?.values?.rate;
  const actions = suggestActions({
    failRate: typeof failRate === 'number' ? failRate : 0,
    p95: typeof p95 === 'number' ? p95 : 0,
    probes: post,
  });

  const report = `# Platform stress report

- **When:** ${new Date().toISOString()}
- **Tier / pattern / duration:** \`${args.tier}\` / \`${args.pattern}\` / \`${args.duration}\`
- **Target:** ${args.target}
- **Wall clock:** ${(elapsedMs / 1000).toFixed(1)}s
- **k6 exit:** ${res.status ?? 'unknown'}

## Key metrics

| Metric | Value |
|--------|-------|
| http_req_failed rate | ${failRate ?? 'n/a'} |
| http_req_duration p95 (ms) | ${p95 ?? 'n/a'} |
| complaint_create_ok rate | ${createRate ?? 'n/a'} |

## Where it may fail

### Pre-run containers
\`\`\`
${(pre.containers || []).join('\n') || '(none)'}
\`\`\`

### Post-run HLF consumer group
\`\`\`
${post.lag_hlf || '(unavailable)'}
\`\`\`

### Post-run events consumer group
\`\`\`
${post.lag_events || '(unavailable)'}
\`\`\`

### fabric-anchor-consumer recent logs
\`\`\`
${post.roadwatch_fabric_anchor_consumer_tail || '(unavailable)'}
\`\`\`

### webhook-handler recent logs
\`\`\`
${post.roadwatch_webhook_handler_tail || '(unavailable)'}
\`\`\`

## Suggested next actions

${actions.map((a) => `- ${a}`).join('\n')}

## Artifacts

- k6 summary: \`logs/stress/k6-summary-${stamp}.json\`
- this report: \`logs/stress/report-${stamp}.md\`
`;

  writeFileSync(reportHost, report);
  if (args.exportPath) {
    const dest = path.resolve(repoRoot, args.exportPath);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (existsSync(summaryHost)) copyFileSync(summaryHost, dest);
    console.log(`[stress] summary copied: ${dest}`);
  }
  console.log(`[stress] report written: ${reportHost}`);
  process.exit(res.status ?? 1);
}

main();
