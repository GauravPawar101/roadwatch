// k6 load-test runner.
//
// Container runtime: podman by default (set CONTAINER_RUNTIME=docker to
// override). The previous version hardcoded `docker` and signed tokens with
// JWT_SECRET, which does not match the gateway's ACCESS_SECRET, so runs
// reported near-total failure unrelated to load.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveAccessSecret, resolveTargetUrl, repoRoot, isColonFormOnly, DEV_DEFAULT } from './resolve-target.mjs';

const K6_IMAGE = process.env.K6_IMAGE ?? 'grafana/k6:latest';
const scriptArg = process.env.K6_SCRIPT ?? 'complaints.js';
const scriptPath = path.join(repoRoot, 'tests', 'load', 'k6', scriptArg);

if (!existsSync(scriptPath)) {
  console.error(`[loadtest] Missing k6 script: ${scriptPath}`);
  process.exit(1);
}

const runtime = process.env.CONTAINER_RUNTIME
  ?? (spawnSync('podman', ['--version'], { stdio: 'ignore' }).status === 0 ? 'podman' : 'docker');

if (spawnSync(runtime, ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error(`[loadtest] Container runtime '${runtime}' is not available.`);
  process.exit(1);
}

const targetUrl = resolveTargetUrl(process.env.TARGET_URL);
const secret = resolveAccessSecret(process.env.JWT_SECRET ?? process.env.ACCESS_SECRET);

console.log(`[loadtest] runtime    : ${runtime}`);
console.log(`[loadtest] target     : ${targetUrl}`);
console.log(`[loadtest] k6 image   : ${K6_IMAGE}`);
console.log(`[loadtest] script     : ${path.relative(repoRoot, scriptPath)}`);

// If we are about to sign with the built-in development secret, say so. A
// mismatch with the gateway shows up as ~100% 401s and is easy to misread as
// an application problem.
if (secret === DEV_DEFAULT) {
  console.warn('[loadtest] WARNING: signing with the built-in development secret.');
  for (const key of ['ACCESS_SECRET', 'JWT_SECRET']) {
    if (isColonFormOnly(key)) {
      console.warn(
        `[loadtest]   .env declares ${key} as "${key}: ..." (Kubernetes-Secret style).` +
        ' dotenv ignores that separator, so the gateway is NOT using it.'
      );
    }
  }
  console.warn('[loadtest]   Set ACCESS_SECRET in the environment (or in the in-cluster');
  console.warn('[loadtest]   app-secrets Secret) if the gateway is using a real secret.');
}

const args = [
  'run', '--rm', '-i',
  '-e', `TARGET_URL=${targetUrl}`,
  '-e', `JWT_SECRET=${secret}`,
  '-e', `ACCESS_SECRET=${secret}`,
  '-v', `${repoRoot}:/work:ro`,
  K6_IMAGE,
  'run', `/work/tests/load/k6/${scriptArg}`,
];

const res = spawnSync(runtime, args, { stdio: 'inherit' });
if (res.error) {
  console.error(`[loadtest] Failed to execute ${runtime}.`);
  throw res.error;
}
process.exit(res.status ?? 1);
