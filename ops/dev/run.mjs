#!/usr/bin/env node
/**
 * Cross-platform script runner: Windows → PowerShell, Linux/macOS → bash.
 *
 * Usage:
 *   node ops/dev/run.mjs setup [--skip-install]
 *   node ops/dev/run.mjs start-all [--skip-fabric]
 *   node ops/dev/run.mjs stop-all
 *   node ops/dev/run.mjs init-messaging
 *   node ops/dev/run.mjs verify-bootstrap
 *   node ops/dev/run.mjs compose -- up -d
 *   node ops/dev/run.mjs fabric-start|fabric-deploy|fabric-reset
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const isWin = process.platform === 'win32';
const action = process.argv[2];
const passthrough = process.argv.slice(3).filter((a) => a !== '--');

if (!action) {
  console.error('Usage: node ops/dev/run.mjs <action> [args...]');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  process.exit(result.status ?? 1);
}

function runPwsh(file, extraArgs = []) {
  run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...extraArgs, ...passthrough]);
}

function runBash(file, extraArgs = []) {
  if (!existsSync(join(repoRoot, file))) {
    console.error(`Missing script: ${file}`);
    process.exit(1);
  }
  run('bash', [file, ...extraArgs, ...passthrough]);
}

const map = {
  setup: () => (isWin ? runPwsh('ops/dev/setup.ps1') : runBash('ops/dev/setup.sh')),
  'start-all': () => (isWin ? runPwsh('ops/dev/start-all.ps1') : runBash('ops/dev/start-all.sh')),
  'stop-all': () => (isWin ? runPwsh('ops/teardown/stop-all.ps1') : runBash('ops/dev/stop-all.sh')),
  'init-messaging': () =>
    isWin ? runPwsh('scripts/init-messaging.ps1') : runBash('scripts/init-messaging.sh'),
  'verify-bootstrap': () =>
    isWin ? runPwsh('ops/dev/verify-bootstrap.ps1') : runBash('ops/dev/verify-bootstrap.sh'),
  compose: () => {
    if (isWin) {
      run('docker', ['compose', ...passthrough]);
    } else {
      runBash('ops/dev/compose.sh');
    }
  },
  'fabric-start': () => {
    if (isWin) {
      run('pwsh', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Users/$([Environment]::UserName)/Desktop/roadwatch/fabric/network && ./scripts/start.sh'",
      ]);
    } else {
      runBash('fabric/network/scripts/start.sh');
    }
  },
  'fabric-deploy': () => {
    if (isWin) {
      run('pwsh', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Users/$([Environment]::UserName)/Desktop/roadwatch/fabric/network && ./scripts/deploy-chaincode.sh'",
      ]);
    } else {
      runBash('fabric/network/scripts/deploy-chaincode.sh');
    }
  },
  'fabric-reset': () => {
    if (isWin) {
      run('pwsh', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Users/$([Environment]::UserName)/Desktop/roadwatch/fabric/network && ./scripts/start.sh --reset'",
      ]);
    } else {
      run('bash', [join(repoRoot, 'fabric/network/scripts/start.sh'), '--reset']);
    }
  },
};

const fn = map[action];
if (!fn) {
  console.error(`Unknown action: ${action}`);
  console.error(`Known: ${Object.keys(map).join(', ')}`);
  process.exit(1);
}

fn();
