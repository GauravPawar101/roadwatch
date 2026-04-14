import { spawnSync } from 'node:child_process';

// Chaos testing is environment-specific.
// This scaffold is a safe entrypoint you can extend with:
// - Fabric docker compose up
// - a loop that submits transactions (gateway client)
// - docker kill/restart of peer/orderer containers mid-run
// - assertions on retry + ledger state

console.log('[chaos] Scaffold only. See docs/testing-strategy.md for the intended chaos workflow.');

// Non-zero exit so it doesn’t silently “pass” in CI.
const shouldPass = process.env.CHAOS_TEST_ENABLED === '1';
if (!shouldPass) {
  console.error('[chaos] Set CHAOS_TEST_ENABLED=1 to run chaos workflows.');
  process.exit(1);
}

// Placeholder: user can wire real commands here.
const res = spawnSync('docker', ['ps'], { stdio: 'inherit' });
process.exit(res.status ?? 1);
