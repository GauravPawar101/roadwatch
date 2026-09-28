import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contractor karma is business data: it drives work_band, SLA penalties and
 * contractor scoring.
 *
 * The adjustment used to be four independent statements each swallowed by
 * `.catch(() => null)`, which allowed the score to move without a ledger
 * record, the ledger to record a delta the score never applied, and a failed
 * score read to default to 0 — overwriting a real work_band with the lowest
 * one. Unlike user karma there is no recalculation that would correct any of
 * it, so a silent drop was permanent and invisible.
 */

const { poolMock, clientMock } = vi.hoisted(() => {
  const client = {
    query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(
      async () => ({ rows: [] }),
    ),
    release: vi.fn(),
  };
  return {
    poolMock: {
      query: vi.fn(async () => ({ rows: [] })),
      connect: vi.fn(async () => client),
      // The scheduler registers an idle-error handler at module load.
      on: vi.fn(),
    },
    clientMock: client,
  };
});

vi.mock('pg', () => ({
  default: { Pool: vi.fn(() => poolMock) },
  Pool: vi.fn(() => poolMock),
}));

// The scheduler imports the resolver and several helpers; stub the ones that
// would otherwise reach a database or the network at module load.
vi.mock('@roadwatch/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@roadwatch/core')>();
  return {
    ...actual,
    resolvePostgresEndpoint: () => ({ connectionString: 'postgresql://stub/roadwatch', source: 'explicit', ssl: false }),
    describeEndpoints: () => 'stub',
    getWorkBandFromScore: (score: number) => `band-${Math.floor(score / 100)}`,
  };
});

// index.ts is safe to import under vitest: its isMain guard is false when
// VITEST is set, so no cron jobs or consumers start.
const { applyContractorKarma: applyContractorKarmaForTest } = await import('./index.js');

const CONTRACTOR = '00000000-0000-4000-8000-0000000000ee';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyContractorKarma atomicity', () => {
  it('commits the score, the work_band and the ledger entry together', async () => {
    clientMock.query.mockImplementation(async (sql: string) => {
      if (/SELECT \(metadata->>'karma_score'\)/i.test(sql)) {
        return { rows: [{ karma_score: 90 }] };
      }
      return { rows: [] };
    });

    await applyContractorKarmaForTest(CONTRACTOR, -20, 'sla_breach', 'complaint-1');

    const statements = clientMock.query.mock.calls.map(c => String(c[0] ?? ''));
    expect(statements.some(s => /BEGIN/i.test(s))).toBe(true);
    expect(statements.some(s => /COMMIT/i.test(s))).toBe(true);
    expect(statements.some(s => /UPDATE contractors/i.test(s) && /karma_score/i.test(s))).toBe(true);
    expect(statements.some(s => /work_band/i.test(s))).toBe(true);
    expect(statements.some(s => /INSERT INTO karma_ledger/i.test(s))).toBe(true);
    expect(clientMock.release).toHaveBeenCalled();
  });

  /**
   * A failed score read used to default to 0, and getWorkBandFromScore(0) then
   * overwrote a real work_band with the lowest band — a fabricated value
   * written to business data.
   */
  it('refuses to rewrite work_band from an unreadable score', async () => {
    clientMock.query.mockImplementation(async (sql: string) => {
      if (/SELECT \(metadata->>'karma_score'\)/i.test(sql)) {
        return { rows: [{ karma_score: null }] };
      }
      return { rows: [] };
    });

    await applyContractorKarmaForTest(CONTRACTOR, -20, 'sla_breach', 'complaint-1');

    const statements = clientMock.query.mock.calls.map(c => String(c[0] ?? ''));
    // Rolled back, so the work_band write is discarded rather than committed.
    expect(statements.some(s => /ROLLBACK/i.test(s))).toBe(true);
    expect(statements.some(s => /COMMIT/i.test(s))).toBe(false);
  });

  it('rolls back and logs rather than leaving a partial karma change', async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });

    clientMock.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO karma_ledger/i.test(sql)) throw new Error('ledger unavailable');
      if (/SELECT \(metadata->>'karma_score'\)/i.test(sql)) return { rows: [{ karma_score: 90 }] };
      return { rows: [] };
    });

    await applyContractorKarmaForTest(CONTRACTOR, -20, 'sla_breach', 'complaint-1');

    const statements = clientMock.query.mock.calls.map(c => String(c[0] ?? ''));
    expect(statements.some(s => /ROLLBACK/i.test(s))).toBe(true);
    // Swallowed failures were the whole problem, so the loss must be visible.
    expect(spy).toHaveBeenCalled();
    expect(String(errors[0]?.[0] ?? '')).toMatch(/contractor karma adjustment failed/);
    spy.mockRestore();
  });

  it('is a no-op without a contractor or a delta', async () => {
    await applyContractorKarmaForTest(null, -20, 'sla_breach', 'complaint-1');
    await applyContractorKarmaForTest(CONTRACTOR, 0, 'sla_breach', 'complaint-1');

    expect(poolMock.connect).not.toHaveBeenCalled();
  });
});
