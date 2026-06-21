const { Pool } = require('pg')

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:16432/roadwatch'

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
})

async function ensureSchema() {
  // DDL centralized in docker/postgres/init.sql; skip creating media/embeddings at runtime.
  console.info('Skipping media/embeddings DDL; ensure docker/postgres/init.sql has been applied');

}

module.exports = { pool, ensureSchema }