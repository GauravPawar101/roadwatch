import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The notification writes must enlist in the caller's transaction.
 *
 * They previously opened their own connection and committed independently, after
 * the complaint had already committed. A failure in that window returned a 500
 * for a durable complaint, and the caller's retry merged into the complaint it
 * had just created — one citizen report became report_count 2. Reproduced
 * end-to-end against a real database before this was fixed.
 */

const { poolMock, connectMock } = vi.hoisted(() => {
  const client = {
    // Typed loosely so the preferences responder can be swapped in per test.
    query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(
      async () => ({ rows: [] }),
    ),
    release: vi.fn(),
  };
  return {
    poolMock: {
      query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(
        async () => ({ rows: [] }),
      ),
      connect: vi.fn(async () => client),
    },
    connectMock: client,
  };
});

vi.mock('../postgres.js', () => ({ pool: poolMock }));
vi.mock('../realtime/sse.js', () => ({ broadcastNotificationEvent: vi.fn() }));

import { createAndFanoutNotification } from './service.js';

const MESSAGE = {
  type: 'new_complaint' as const,
  title: 'New complaint',
  body: 'body',
  data: { complaintId: 'c1' },
  audience: { kind: 'user' as const, userId: '00000000-0000-4000-8000-0000000000dd' },
};

/** A row shaped like notification_preferences, so the preferences lookup resolves. */
const PREFS_ROW = {
  user_id: '00000000-0000-4000-8000-0000000000dd',
  enabled_channels: ['IN_APP'],
  dnd_enabled: false,
  dnd_start_minutes: 0,
  dnd_end_minutes: 0,
  time_zone: 'UTC',
  authority_batching: 'IMMEDIATE',
  digest_minutes: 60,
};

/** Returns the preferences row for the preferences SELECT, empty for anything else. */
function rowsFor(sql: string): { rows: unknown[] } {
  return /FROM\s+notification_preferences/i.test(String(sql)) ? { rows: [PREFS_ROW] } : { rows: [] };
}

/** A recording executor backed by rowsFor. */
function fakeExecutor(onQuery?: (sql: string) => void) {
  return {
    query: vi.fn(async (sql: string) => {
      onQuery?.(String(sql));
      return rowsFor(sql);
    }),
  };
}

/** Users matching a PUN/Z1 jurisdiction audience: a CE scoped to all, a Pune EE, a Mumbai EE. */
const JURISDICTION_USERS = [
  { id: 'ce-all', role: 'CE', districts: ['ALL'], zones: ['ALL'] },
  { id: 'ee-pun-z1', role: 'EE', districts: ['PUN'], zones: ['Z1'] },
  { id: 'ee-mum', role: 'EE', districts: ['MUM'], zones: ['ALL'] }
];

function rowsForAudience(sql: string): { rows: unknown[] } {
  if (/FROM\s+users/i.test(String(sql))) return { rows: JURISDICTION_USERS };
  return rowsFor(sql);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The pool's own client must satisfy the preferences lookup too, or the
  // no-transaction path throws before reaching the assertions.
  connectMock.query.mockImplementation(async (sql: string) => rowsForAudience(sql));
  poolMock.query.mockImplementation(async (sql: string) => rowsForAudience(sql));
});

describe('createAndFanoutNotification transaction enlistment', () => {
  it('does not open or close a transaction when given one', async () => {
    const tx = fakeExecutor();

    await createAndFanoutNotification({ message: MESSAGE, tx });

    expect(poolMock.connect).not.toHaveBeenCalled();
    // No BEGIN / COMMIT / ROLLBACK may reach the caller's transaction.
    const statements = tx.query.mock.calls.map(c => String(c[0] ?? ''));
    expect(statements.join('\n')).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK)\b/i);
  });

  it('still opens and closes its own transaction when given none', async () => {
    await createAndFanoutNotification({ message: MESSAGE });

    expect(poolMock.connect).toHaveBeenCalledTimes(1);
    const statements = connectMock.query.mock.calls.map(c => String(c[0] ?? ''));
    expect(statements.some(s => /BEGIN/i.test(s))).toBe(true);
    expect(statements.some(s => /COMMIT/i.test(s))).toBe(true);
    expect(connectMock.release).toHaveBeenCalled();
  });

  /**
   * A live SSE push must not escape before the surrounding transaction commits,
   * or a client can be shown a notification that is then rolled back.
   */
  it('defers the live broadcast instead of emitting it mid-transaction', async () => {
    const { broadcastNotificationEvent } = await import('../realtime/sse.js');
    const tx = fakeExecutor();
    const deferred: Array<() => void> = [];

    await createAndFanoutNotification({ message: MESSAGE, tx, deferBroadcasts: deferred });

    expect(broadcastNotificationEvent).not.toHaveBeenCalled();
    expect(deferred.length).toBeGreaterThan(0);

    deferred.forEach(fn => fn());
    expect(broadcastNotificationEvent).toHaveBeenCalled();
  });

  it('emits the broadcast immediately when there is no caller transaction', async () => {
    const { broadcastNotificationEvent } = await import('../realtime/sse.js');

    await createAndFanoutNotification({ message: MESSAGE });

    expect(broadcastNotificationEvent).toHaveBeenCalled();
  });

  it('propagates a failure so the caller can roll the whole thing back', async () => {
    const tx = {
      query: vi.fn(async () => {
        throw new Error('notifications table missing');
      }),
    };

    await expect(createAndFanoutNotification({ message: MESSAGE, tx })).rejects.toThrow(
      'notifications table missing',
    );
  });
});

/**
 * Connection discipline on the write path.
 *
 * `POST /authority/complaints` holds a Postgres connection for the whole of its
 * transaction. If notification fan-out borrows a second connection from the pool
 * while that transaction is open, then N concurrent writes need 2N connections,
 * and the pool exhausts at N = PGPOOL_MAX/2. Measured on the hot partition:
 * raising PGPOOL_MAX 60 -> 90 moved the write ceiling from 278/s to 464/s and
 * removed every 500, and above the ceiling requests failed with
 * `timeout exceeded when trying to connect` originating at resolveAudienceUsers
 * while consuming *less* CPU — blocked, not computing.
 *
 * So the audience lookup has to run on the executor the caller supplied, and the
 * executor it was given has to be the transaction.
 */
describe('notification audience resolution uses the caller executor', () => {
  const jurisdictionAudience = {
    kind: 'jurisdiction' as const,
    district: 'PUN',
    zone: 'Z1'
  };

  const buildExecutor = () => {
    const seen: string[] = [];
    const query = vi.fn(async (text: string) => {
      seen.push(text);
      return rowsForAudience(text) as any;
    });
    return { query, seen, executor: { query } as any };
  };

  it('resolves the audience through the supplied transaction client', async () => {
    const { executor, seen } = buildExecutor();

    const { userIds } = await createAndFanoutNotification({
      message: {
        type: 'new_complaint',
        title: 't',
        body: 'b',
        audience: jurisdictionAudience
      } as any,
      tx: executor
    });

    // Scoped to PUN/Z1: the CE with ALL and the Pune EE qualify, Mumbai does not.
    expect(userIds).toEqual(['ce-all', 'ee-pun-z1']);

    // The decisive assertion: the users query went through the caller's executor.
    // If it had used the module-level pool, `seen` would not contain it, and the
    // write path would need a second connection per request.
    expect(seen.some((t) => /FROM users/.test(t))).toBe(true);
  });

  it('still resolves correctly with no transaction supplied', async () => {
    const { userIds } = await createAndFanoutNotification({
      message: {
        type: 'new_complaint',
        title: 't',
        body: 'b',
        audience: jurisdictionAudience
      } as any
    });

    expect(userIds).toEqual(['ce-all', 'ee-pun-z1']);
  });
});
