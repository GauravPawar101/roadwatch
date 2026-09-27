import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import pg from 'pg';
import { normaliseSslMode, resolvePostgresEndpoint } from '@roadwatch/core';

const workspaceRoot = resolve(new URL(import.meta.url).pathname, '..', '..', '..', '..');
loadEnv({ path: resolve(workspaceRoot, 'apps/gateway-api/.env'), override: false });

// Managed/cloud endpoint -> DATABASE_URL -> in-cluster/local parts.
const database = resolvePostgresEndpoint(process.env, {
  host: '127.0.0.1',
  port: '16432',
  db: 'roadwatch',
  user: 'postgres',
  password: 'postgres',
});

const connectionString = database.connectionString || 'postgres://postgres:postgres@127.0.0.1:16432/roadwatch';

const { Pool } = pg;

/**
 * Pool sizing.
 *
 * PGPOOL_MAX matches the convention already used by the adapter pool in
 * @roadwatch/core, so one variable tunes both.
 *
 * This value and COMPLAINT_WRITE_MAX_INFLIGHT must be kept in step. Each
 * admitted complaint write holds a connection for the length of its
 * transaction, so an inflight cap above the pool size converts cheap 429
 * rejections into multi-second waits on connection acquire, ending in a 500
 * ("timeout exceeded when trying to connect"). Measured with inflight 400
 * against a pool of 20: p95 3.06 s and 31 failed requests; with inflight
 * matched to the pool: p95 423 ms and none.
 *
 * Postgres defaults to max_connections = 100, so the ceiling across all
 * application pools on one database is that number, not this one.
 */
const poolMax = (() => {
  const parsed = Number.parseInt(process.env.PGPOOL_MAX ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
})();

const realPool = new Pool({
  // Rewritten so `?sslmode=require` means "encrypt" rather than "verify the
  // chain", which is what pg-connection-string >= 2.7 otherwise does and which
  // a managed provider's private-CA certificate cannot satisfy. `ssl` was
  // previously not passed here at all, so a managed endpoint could not connect.
  connectionString: normaliseSslMode(connectionString, database.ssl),
  ssl: database.ssl ? { rejectUnauthorized: false } : undefined,
  max: poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

realPool.on('error', (err) => {
  console.error('[postgres] Unexpected error on idle client:', err instanceof Error ? err.message : String(err));
});

// Helper to check TemplateStringsArray (kept for compatibility)
function isTemplateStringsArray(arg: any): arg is TemplateStringsArray {
  return Array.isArray(arg) && 'raw' in arg;
}

type SqlFragment = {
  __isSqlFragment: true;
  text: string;
  values: any[];
};

function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as SqlFragment).__isSqlFragment === true &&
    typeof (value as SqlFragment).text === 'string' &&
    Array.isArray((value as SqlFragment).values)
  );
}

function shiftPlaceholders(text: string, offset: number): string {
  if (offset === 0) return text;
  return text.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + offset}`);
}

function buildSql(strings: TemplateStringsArray, values: any[]): { text: string; values: any[] } {
  let text = strings[0] ?? '';
  const params: any[] = [];
  let paramIndex = 1;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];

    if (isSqlFragment(value)) {
      text += shiftPlaceholders(value.text, paramIndex - 1);
      params.push(...value.values);
      paramIndex += value.values.length;
    } else {
      text += `$${paramIndex}`;
      params.push(value);
      paramIndex += 1;
    }

    text += strings[i + 1] ?? '';
  }

  return { text, values: params };
}

function makeUpdateFragment(updates: Record<string, any>, keys: string[]): SqlFragment {
  const cols = keys.length ? keys : Object.keys(updates);
  const values = cols.map((k) => updates[k]);
  const text = cols.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
  return { __isSqlFragment: true, text, values };
}

function createSqlExecutor(executor: (text: string, values: any[]) => Promise<any[]>) {
  const tag = (async (first: any, ...rest: any[]) => {
    if (isTemplateStringsArray(first)) {
      const built = buildSql(first, rest);
      return executor(built.text, built.values);
    }

    // Compatibility helper for dynamic update sets: tx(updates, keys)
    if (first && typeof first === 'object' && Array.isArray(rest[0])) {
      return makeUpdateFragment(first as Record<string, any>, rest[0] as string[]);
    }

    throw new TypeError('sql must be used as a template tag or tx(updates, keys) helper');
  }) as any;

  tag.begin = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const client = await realPool.connect();
    try {
      await client.query('BEGIN');
      const tx = createSqlExecutor(async (text, values) => (await client.query(text, values)).rows);
      // Outbox + other helpers expect a pg-style client.query inside transactions.
      tx.query = (text: string, values?: any[]) => client.query(text, values);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  return tag;
}

/**
 * Build a composable SQL fragment without executing it.
 *
 * The `pool` tag executes and returns rows, so it can never be used to build a
 * partial statement. The list endpoints built their WHERE clauses as
 * `let cond = pool``; if (x) cond = pool`AND col = ${x}``, which produced a
 * *Promise* in the variable. Interpolating that Promise into the outer template
 * failed the isSqlFragment check, so the condition was never spliced into the
 * SQL and the parameter list was shifted past a placeholder that no longer
 * existed — Postgres rejected it with `syntax error at or near "$1"` and the
 * endpoint returned 500 for every request. Two read endpoints were affected.
 *
 * This returns the fragment shape the executor actually understands, so
 * placeholders are renumbered correctly when spliced.
 */
export function sqlFragment(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  const built = buildSql(strings, values);
  return { __isSqlFragment: true, text: built.text, values: built.values };
}

// Simple query wrapper using the shared PgBouncer-backed pg pool
export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: any[]): Promise<pg.QueryResult<T>> =>
  realPool.query<T>(text, params);

// Compatibility layer for legacy tagged-template SQL usage.
export const sql = createSqlExecutor(async (text, values) => (await realPool.query(text, values)).rows);

// Transaction helper – provides a client for all queries inside the callback
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await realPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Helper to build UPDATE SET clause from an object
export function buildUpdate(updates: Record<string, any>) {
  const setClauses: string[] = [];
  const values: any[] = [];
  let idx = 1;
  for (const [k, v] of Object.entries(updates)) {
    setClauses.push(`"${k}" = $${idx++}`);
    values.push(v);
  }
  return { setClause: setClauses.join(', '), values };
}

// Export a thin pool proxy for compatibility (exposes pg.Pool methods)
export const pool = new Proxy(realPool, {
  get(target, prop, receiver) {
    const val = Reflect.get(target, prop);
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
}) as pg.Pool;

// Existing connection helpers
export async function connect(): Promise<void> {
  try {
    const client = await realPool.connect();
    try {
      await client.query('SELECT NOW()');
      console.log('[postgres] connected successfully');
      // Ensure notification_inbox exists to avoid runtime errors when DB was not
      // initialized with the repo's init.sql (e.g., when connecting to an existing DB).
      try {
        // DDL centralized in docker/postgres/init.sql; skip runtime creation of notification_inbox here.
        console.info('[postgres] skipping runtime creation of notification_inbox; ensure docker/postgres/init.sql has been applied');
      } catch (err) {
        console.warn('[postgres] connect warning when checking notification_inbox:', err instanceof Error ? err.message : String(err));
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[postgres] connect warning:', err instanceof Error ? err.message : String(err));
  }
}

export async function shutdown(): Promise<void> {
  try {
    await realPool.end();
  } catch (err) {
    console.warn('[postgres] shutdown warning:', err instanceof Error ? err.message : String(err));
  }
}