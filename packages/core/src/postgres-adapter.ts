import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Fallback to individual env vars if DATABASE_URL is not set
  host:     process.env.PGHOST     || '127.0.0.1',
  port:     Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'roadwatch',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
  // Reasonable defaults for a backend API process
  max:              Number(process.env.PGPOOL_MAX      || 20),
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONN_TIMEOUT_MS || 5_000),
});

pool.on('error', (err) => {
  console.error('[postgres] idle client error', err);
});

export default pool;