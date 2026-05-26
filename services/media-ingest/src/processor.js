const fetch = require('node-fetch')
const { pool } = require('./db.js')

const HF_API_KEYS = (process.env.HF_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)
const PINECONE_API_KEY = process.env.PINECONE_API_KEY
const PINECONE_ENV = process.env.PINECONE_ENV
const PINECONE_INDEX = process.env.PINECONE_INDEX || 'roadwatch-media'

async function callHuggingFaceImageEmbedding(buffer) {
  if (!HF_API_KEYS || HF_API_KEYS.length === 0) throw new Error('HF_API_KEYS not set')
  // rotate keys to spread rate limits (random pick)
  const token = HF_API_KEYS[Math.floor(Math.random() * HF_API_KEYS.length)]
  const model = process.env.HF_MODEL || 'openai/clip-vit-base-patch32'
  const url = `https://api-inference.huggingface.co/models/${model}`
  // use multipart/form-data to support large images reliably
  const FormData = require('form-data')
  const form = new FormData()
  form.append('file', buffer, { filename: 'upload.jpg' })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      // form headers will be set by form.getHeaders when using node-fetch
      ...form.getHeaders()
    },
    body: form
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`HF inference failed: ${res.status} ${txt}`)
  }
  const json = await res.json()
  // Hugging Face returns a 2D array for feature-extraction; flatten if needed
  if (Array.isArray(json) && Array.isArray(json[0])) return json.flat()
  return json
}

async function upsertToVectorDB(uploadId, vector) {
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    console.warn('No vector provided; skipping vector DB upsert')
    return
  }
  // store vector in Postgres pgvector extension (free alternative to Pinecone)
  try {
    const vectorString = `[${vector.join(',')}]`

    await pool.query(
      `INSERT INTO embeddings (upload_id, embedding, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (upload_id) DO UPDATE 
         SET embedding = EXCLUDED.embedding,
             created_at = NOW()`,
      [uploadId, vectorString]
    )
    console.log(`Successfully stored vector embedding for upload_id: ${uploadId} in PostgreSQL`)
  } catch (err) {
    console.error('Failed storing vector in PostgreSQL:', err)
    throw err
  }
}

module.exports = {
  callHuggingFaceImageEmbedding,
  upsertToVectorDB
}