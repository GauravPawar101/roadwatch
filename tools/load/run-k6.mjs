import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, 'tests', 'load', 'k6', 'complaints.js');

if (!existsSync(scriptPath)) {
  console.error(`[loadtest] Missing k6 script: ${scriptPath}`);
  process.exit(1);
}

const targetUrl = process.env.TARGET_URL ?? 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET ?? 'local_development_cryptographic_secret';

const dockerArgs = [
  'run',
  '--rm',
  '-i',
  '-e',
  `TARGET_URL=${targetUrl}`,
  '-e',
  `JWT_SECRET=${jwtSecret}`,
  '-v',
  `${repoRoot}:/work:ro`,
  'grafana/k6:latest',
  'run',
  `/work/tests/load/k6/complaints.js`
];

console.log(`[loadtest] Running k6 against ${targetUrl}`);
const res = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
if (res.error) {
  console.error('[loadtest] Failed to execute docker. Is Docker installed and running?');
  throw res.error;
}
process.exit(res.status ?? 1);
