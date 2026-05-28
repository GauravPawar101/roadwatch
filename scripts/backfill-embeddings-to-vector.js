#!/usr/bin/env node
/**
 * Backfill `embeddings.embedding` (JSONB array) into `embeddings.embedding_vector` (pgvector)
 * Usage:
 *   PG_CONNECTION_STRING=postgres://user:pass@host:5432/roadwatch node scripts/backfill-embeddings-to-vector.js
 * Options via env:
 *   BATCH_SIZE (default 500)
 *   EMBEDDING_DIM (default 1536)
 *   DRY_RUN (if '1' or 'true', no UPDATEs are executed)
 *   CREATE_INDEX (if '1' or 'true', attempt to create ivfflat index after backfill)
 *
 * Notes:
 * - This script will skip rows where the embedding is missing, not an array, or has a mismatched length.
 * - Creating the ivfflat index requires the `vector` extension to be installed on the Postgres instance
 *   and sufficient DB privileges. The script checks for the `vector` type before attempting index creation.
 */

const { Pool } = require('pg')

const connectionString = process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL || 'postgres://localhost:6432/roadwatch'
const BATCH = parseInt(process.env.BATCH_SIZE || '500')
const DIM = parseInt(process.env.EMBEDDING_DIM || '1536')
const DRY = String(process.env.DRY_RUN || '').toLowerCase() === '1' || String(process.env.DRY_RUN || '').toLowerCase() === 'true'
const CREATE_INDEX = String(process.env.CREATE_INDEX || '').toLowerCase() === '1' || String(process.env.CREATE_INDEX || '').toLowerCase() === 'true'

const pool = new Pool({ connectionString })

async function existsVectorType() {
  const r = await pool.query("SELECT 1 FROM pg_type WHERE typname = 'vector' LIMIT 1")
  return r.rowCount > 0
}

async function createIvfIndex() {
  const hasVector = await existsVectorType()
  if (!hasVector) {
    console.log('pgvector not available on this DB; skipping index creation')
    return
  }
  try {
    console.log('Creating ivfflat index (if not exists)')
    await pool.query("CREATE INDEX IF NOT EXISTS embeddings_embedding_vector_idx ON embeddings USING ivfflat (embedding_vector) WITH (lists = 100)")
    console.log('Index creation attempted')
  } catch (err) {
    console.warn('Index creation failed:', err.message || err)
  }
}

async function backfill() {
  console.log(`Starting backfill: batch=${BATCH}, dim=${DIM}, dry_run=${DRY}`)
  let offset = 0
  let total = 0
  let updated = 0
  let skipped = 0

  while (true) {
    const res = await pool.query('SELECT upload_id, embedding, embedding_vector FROM embeddings ORDER BY upload_id LIMIT $1 OFFSET $2', [BATCH, offset])
    if (!res.rows || res.rows.length === 0) break

    for (const row of res.rows) {
      total++
      const uploadId = row.upload_id
      // Skip if embedding_vector already present
      if (row.embedding_vector !== null) {
        skipped++
        continue
      }

      let emb = row.embedding
      if (emb == null) {
        console.warn('No embedding for', uploadId)
        skipped++
        continue
      }

      // Embedding may be stored as JSONB array or a string representation
      if (typeof emb === 'string') {
        try { emb = JSON.parse(emb) } catch (e) { }
      }

      if (!Array.isArray(emb)) {
        console.warn('Embedding not an array for', uploadId)
        skipped++
        continue
      }

      if (emb.length !== DIM) {
        console.warn(`Embedding length mismatch for ${uploadId}: got ${emb.length}, expected ${DIM}`)
        skipped++
        continue
      }

      const vectorLiteral = `[${emb.join(',')}]`

      if (DRY) {
        console.log('[DRY] would update', uploadId)
        updated++
        continue
      }

      try {
        await pool.query('UPDATE embeddings SET embedding_vector = $2::vector WHERE upload_id = $1', [uploadId, vectorLiteral])
        updated++
      } catch (err) {
        // If pgvector isn't installed, this will fail — warn and continue
        console.warn('Failed to update vector for', uploadId, err.message || err)
        skipped++
      }
    }

    offset += res.rows.length
    console.log(`Processed ${offset} rows (updated=${updated}, skipped=${skipped})`)
    if (res.rows.length < BATCH) break
  }

  console.log('Backfill complete:', { total, updated, skipped })

  if (CREATE_INDEX && !DRY) {
    await createIvfIndex()
  }
}

backfill().then(() => {
  return pool.end()
}).catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(2)
})
