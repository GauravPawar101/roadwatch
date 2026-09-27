import pg from 'pg';
import { resolvePostgresEndpoint } from './config/endpoints.js';
import { normaliseSslMode } from './ssl-mode.js';

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
    connectionString: normaliseSslMode(connectionString, endpoint.ssl),
    // Managed Postgres (RDS, Neon, Supabase, Cloud SQL, Aiven) refuses
    // plaintext, and its certificate is normally issued for the provider's own
    // hostname, so chain verification against the connection host would fail.
    ssl: endpoint.ssl ? { rejectUnauthorized: false } : undefined,
    // PGPOOL_MAX for consistency with the adapter pool. Keep this in step with
    // any admission-control inflight cap: a cap above the pool size turns
    // rejections into connection-acquire timeouts.
    max: tuning.max ?? positiveInt(env.PGPOOL_MAX, 20),
    idleTimeoutMillis: tuning.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: tuning.connectionTimeoutMillis ?? 5_000,
  });
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const pool = createPool();

pool.on('error', (err: Error) => {
  console.error('[postgres] idle client error', err);
});

export default pool;
