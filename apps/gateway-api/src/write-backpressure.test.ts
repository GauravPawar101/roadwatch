import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireReadAdmission } from './security/write-backpressure.js';

/**
 * The admission-mismatch warning describes a fixed configuration, so it belongs at
 * startup. It used to be emitted from inside the per-request admission path, which
 * meant every request re-derived and re-logged the same fact.
 *
 * The cost was not hypothetical. A capacity run at a deliberate
 * inflight-above-pool setting produced 13 MB of identical warnings, and the
 * resulting `console` writes were 3.9% of gateway CPU on a read sweep — enough to
 * be misread as a read-path regression when the read path had not changed at all.
 */

const savedEnv = { ...process.env };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Admission evaluates a Lua script in Redis, so the warning path is only
  // reachable with a real instance. The suite task does not load .env, so point
  // at the on-device instance rather than skipping.
  process.env.REDIS_URL ??= 'redis://127.0.0.1:16379/0';
});

afterEach(() => {
  warn.mockRestore();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  vi.resetModules();
});

async function admitMany(times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const { release } = await acquireReadAdmission({
      routeScope: 'test:pool-mismatch',
      principal: 'tester'
    });
    await release();
  }
}

describe('pool mismatch warning', () => {
  it('warns once for a repeated configuration, not once per request', async () => {
    process.env.READ_ADMISSION = 'on';
    process.env.READ_MAX_INFLIGHT = '160';
    process.env.PGPOOL_MAX = '20';

    await admitMany(25);

    const mismatch = warn.mock.calls.filter(call =>
      String(call[0]).includes('exceeds PGPOOL_MAX')
    );
    expect(mismatch).toHaveLength(1);
  });

  it('does not warn when the inflight cap is within the pool', async () => {
    process.env.READ_ADMISSION = 'on';
    process.env.READ_MAX_INFLIGHT = '20';
    process.env.PGPOOL_MAX = '20';

    await admitMany(5);

    const mismatch = warn.mock.calls.filter(call =>
      String(call[0]).includes('exceeds PGPOOL_MAX')
    );
    expect(mismatch).toHaveLength(0);
  });

  it('stays off when read admission is disabled', async () => {
    process.env.READ_ADMISSION = '';
    process.env.READ_MAX_INFLIGHT = '160';
    process.env.PGPOOL_MAX = '20';

    await admitMany(5);

    const mismatch = warn.mock.calls.filter(call =>
      String(call[0]).includes('exceeds PGPOOL_MAX')
    );
    expect(mismatch).toHaveLength(0);
  });
});
