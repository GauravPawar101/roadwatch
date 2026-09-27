import pg from 'pg';
import { resolvePostgresEndpoint } from './config/endpoints.js';
import { normaliseSslMode } from './ssl-mode.js';

const { Pool } = pg;

const LOCAL_FALLBACK = 'postgres://127.0.0.1:5432/roadwatch';

export type AdapterPoolTuning = {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
};

/**
 * Pool for adapter-style callers.
 *
 * Previously this passed both `connectionString: process.env.DATABASE_URL` and
 * a full set of host/port/database defaults. That combination ignored
 * DATABASE_CLOUD_URL entirely, and — because a connection string always wins
 * over the individual fields in `pg` — the fallback defaults could never take
 * effect once DATABASE_URL was set, not even to fill in a missing piece.
 * Resolving to a single connection string removes that ambiguity.
 */
export function createAdapterPool(
  env: NodeJS.ProcessEnv = process.env,
  tuning: AdapterPoolTuning = {},
): pg.Pool {
  const endpoint = resolvePostgresEndpoint(env, {
    host: '127.0.0.1',
    port: '5432',
    db: 'roadwatch',
    user: 'postgres',
  });
  const connectionString = endpoint.connectionString || LOCAL_FALLBACK;

  return new Pool({
    // sslmode=require is rewritten to node-postgres' own no-verify spelling;
    // see normaliseSslMode for why, and for the verify-full case it leaves alone.
    connectionString: normaliseSslMode(connectionString, endpoint.ssl),
    ssl: endpoint.ssl ? { rejectUnauthorized: false } : undefined,
    max: tuning.max ?? 20,
    idleTimeoutMillis: tuning.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: tuning.connectionTimeoutMillis ?? 5_000,
  });
}

export const pool = createAdapterPool();

pool.on('error', (err) => {
  console.error('[postgres] idle client error', err);
});

export default pool;
