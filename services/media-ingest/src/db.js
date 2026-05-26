const { Pool } = require('pg')

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:6432/roadwatch'

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
  // Create tables used by media-ingest
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media (
      upload_id TEXT PRIMARY KEY,
      object_key TEXT,
      sha256 TEXT,
      metadata TEXT,
      hf_result TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS embeddings (
      upload_id TEXT PRIMARY KEY,
      embedding TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pinata_webhook_retries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cid TEXT,
      payload TEXT,
      attempts INT DEFAULT 0,
      last_error TEXT,
      next_attempt TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
}

module.exports = { pool, ensureSchema }