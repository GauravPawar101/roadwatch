const fetch = require('node-fetch')
const { pool } = require('./db.js')

const HF_API_KEYS = (process.env.HF_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)
const PINECONE_API_KEY = process.env.PINECONE_API_KEY
const PINECONE_INDEX = process.env.PINECONE_INDEX || 'roadwatch-media'
const HF_YOLO_MODEL = process.env.HF_YOLO_MODEL || 'ultralytics/yolov8n'
const HF_RESNET_MODEL = process.env.HF_RESNET_MODEL || 'microsoft/resnet-50'

function formatScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return score ?? null
  }

  return Number(score.toFixed(4))
}

function normalizeClassificationResult(result) {
  const predictions = Array.isArray(result) ? result : []

  return predictions.slice(0, 5).map((item) => ({
    label: item.label || item.class || item.name || 'unknown',
    score: formatScore(item.score)
  }))
}

function normalizeDetectionResult(result) {
  const detections = Array.isArray(result) ? result : []

  return detections.slice(0, 10).map((item) => ({
    label: item.label || item.class || item.name || 'unknown',
    score: formatScore(item.score),
    box: item.box || null
  }))
}

async function callHuggingFaceImageTask(buffer, model, contentType) {
  if (!HF_API_KEYS || HF_API_KEYS.length === 0) throw new Error('HF_API_KEYS not set')
  // rotate keys to spread rate limits (random pick)
  const token = HF_API_KEYS[Math.floor(Math.random() * HF_API_KEYS.length)]
  const url = `https://api-inference.huggingface.co/models/${model}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': contentType || 'application/octet-stream',
      'x-wait-for-model': 'true'
    },
    body: buffer
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`HF inference failed: ${res.status} ${txt}`)
  }
  return res.json()
}

async function callHuggingFaceImageEmbedding(buffer) {
  const model = process.env.HF_MODEL || 'openai/clip-vit-base-patch32'
  const json = await callHuggingFaceImageTask(buffer, model, 'image/jpeg')

  // Hugging Face returns a 2D array for feature-extraction; flatten if needed.
  if (Array.isArray(json) && Array.isArray(json[0])) return json.flat()
  return json
}

async function analyzeImageWithHuggingFace(buffer, contentType) {
  const tasks = [
    {
      key: 'yolo',
      model: HF_YOLO_MODEL,
      normalize: normalizeDetectionResult
    },
    {
      key: 'resnet',
      model: HF_RESNET_MODEL,
      normalize: normalizeClassificationResult
    }
  ]

  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      const raw = await callHuggingFaceImageTask(buffer, task.model, contentType)
      return {
        model: task.model,
        results: task.normalize(raw)
      }
    })
  )

  return settled.reduce((acc, outcome, index) => {
    const task = tasks[index]
    if (outcome.status === 'fulfilled') {
      acc[task.key] = outcome.value
    } else {
      acc[task.key] = {
        model: task.model,
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        results: []
      }
    }
    return acc
  }, {})
}

async function upsertToVectorDB(uploadId, vector) {
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    console.warn('No vector provided; skipping vector DB upsert')
    return
  }
  // store vector in Postgres pgvector extension (free alternative to Pinecone)
  try {
    const vectorJson = JSON.stringify(vector)
    const vectorString = `[${vector.join(',')}]`

    await pool.query(
      `INSERT INTO embeddings (upload_id, embedding, created_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (upload_id) DO UPDATE 
         SET embedding = EXCLUDED.embedding,
             created_at = NOW()`,
      [uploadId, vectorJson]
    )

    // Try to populate the pgvector column if the extension is available.
    try {
      await pool.query(
        `UPDATE embeddings SET embedding_vector = $2::vector WHERE upload_id = $1`,
        [uploadId, vectorString]
      )
    } catch (err) {
      // pgvector may not be installed on this DB; that's fine for now.
      console.debug('pgvector update skipped or failed:', err.message || err)
    }
    console.log(`Successfully stored vector embedding for upload_id: ${uploadId} in PostgreSQL`)
  } catch (err) {
    console.error('Failed storing vector in PostgreSQL:', err)
    throw err
  }
}

module.exports = {
  analyzeImageWithHuggingFace,
  callHuggingFaceImageEmbedding,
  upsertToVectorDB
}