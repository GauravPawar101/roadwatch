import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression guard for a total endpoint failure.
 *
 * The list endpoints built their WHERE clauses as
 *   let cond = pool``; if (x) cond = pool`AND col = ${x}`;
 * but the `pool` tag *executes* and returns rows, so `cond` held a Promise, not
 * a fragment. Interpolating it into the outer template failed the fragment
 * check, so the condition was never spliced into the SQL while the parameter
 * list was still advanced past a placeholder that no longer existed. Postgres
 * rejected it with `syntax error at or near "$1"` and every request to
 * GET /authority/complaints and the history endpoint returned 500.
 *
 * The suite did not catch it because no test exercised a composed WHERE clause.
 */

const { poolMock, clientMock } = vi.hoisted(() => {
  const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
  return {
    poolMock: {
      query: vi.fn(async () => ({ rows: [] })),
      connect: vi.fn(async () => client),
      on: vi.fn(),
    },
    clientMock: client,
  };
});

// Only `pg` is mocked. postgres.js is the module under test, so mocking it
// would replace the very export being asserted on.
vi.mock('pg', () => ({ default: { Pool: vi.fn(() => poolMock) }, Pool: vi.fn(() => poolMock) }));

import { sqlFragment } from './postgres.js';

beforeEach(() => {
  vi.clearAllMocks();
  clientMock.query.mockResolvedValue({ rows: [] });
});

describe('sqlFragment', () => {
  it('returns a fragment rather than executing or returning a promise', () => {
    const fragment = sqlFragment`AND district = ${'PUN'}`;

    expect(fragment).toEqual({
      __isSqlFragment: true,
      text: 'AND district = $1',
      values: ['PUN'],
    });
    // The decisive property: the old pattern produced a Promise here.
    expect(fragment).not.toBeInstanceOf(Promise);
    expect(typeof (fragment as { then?: unknown }).then).toBe('undefined');
  });

  it('represents an omitted condition as an empty fragment', () => {
    expect(sqlFragment``).toEqual({ __isSqlFragment: true, text: '', values: [] });
  });

  it('renumbers placeholders so composed fragments do not collide', () => {
    const district = sqlFragment`AND district = ${'PUN'}`;
    const zone = sqlFragment`AND zone = ${'Z1'}`;

    // Mirrors buildSql: a fragment's own $1 is shifted by the parameters
    // already bound, which is what produced the dangling $1 before.
    const bound: unknown[] = [];
    let index = 1;
    for (const fragment of [district, zone]) {
      for (const match of fragment.text.matchAll(/\$(\d+)/g)) {
        bound.push(`${match[1]}->${Number(match[1]) + index - 1}`);
      }
      index += fragment.values.length;
    }

    expect(bound).toEqual(['1->1', '1->2']);
  });

  it('keeps an ANY() array parameter intact', () => {
    const fragment = sqlFragment`AND district = ANY(${['PUN', 'MUM']})`;
    expect(fragment.text).toBe('AND district = ANY($1)');
    expect(fragment.values).toEqual([['PUN', 'MUM']]);
  });
});
