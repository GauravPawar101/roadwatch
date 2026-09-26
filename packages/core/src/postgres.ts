import pg from 'pg';
import { resolvePostgresEndpoint } from './config/endpoints.js';

const { Pool } = pg;

/**
 * Default used only when nothing at all is configured, so a developer with no
 * .env still gets a predictable local target instead of an opaque driver error.
 */
const LOCAL_FALLBACK = 'postgres://localhost:6432/roadwatch';

export type PoolTuning = {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
};

/**
 * Builds a pg Pool from the shared endpoint resolver.
 *
 * The resolver is consulted rather than reading DATABASE_URL directly, because
 * a managed endpoint is chosen by setting DATABASE_CLOUD_URL while
 * DATABASE_URL stays pointed at the in-cluster service. Reading DATABASE_URL
 * here would silently ignore the managed choice — which is exactly what this
 * function previously did.
 */
export function createPool(
  env: NodeJS.ProcessEnv = process.env,
  tuning: PoolTuning = {},
): pg.Pool {
  const endpoint = resolvePostgresEndpoint(env);
  const connectionString = endpoint.connectionString || LOCAL_FALLBACK;

  return new Pool({
    connectionString,
    // Managed Postgres (RDS, Neon, Supabase, Cloud SQL) refuses plaintext, and
    // its certificate is normally issued for the provider's own hostname, so
    // chain verification against the connection host would fail. `sslmode`
    // in the URL is honoured by `pg` and takes precedence over this flag.
    ssl: endpoint.ssl ? { rejectUnauthorized: false } : undefined,
    max: tuning.max ?? 20,
    idleTimeoutMillis: tuning.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: tuning.connectionTimeoutMillis ?? 5_000,
  });
}

export const pool = createPool();

pool.on('error', (err: Error) => {
  console.error('[postgres] idle client error', err);
});

export default pool;
