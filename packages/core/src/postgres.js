import pg from 'pg';
const { Pool } = pg;
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:6432/roadwatch',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});
pool.on('error', (err) => {
    console.error('[postgres] idle client error', err);
});
export default pool;
//# sourceMappingURL=postgres.js.map