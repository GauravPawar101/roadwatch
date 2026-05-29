const express = require('express')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })
const { uploadBufferToSupabase } = require('./supabase')
const { pool, ensureSchema } = require('./db')
const { analyzeImageWithHuggingFace } = require('./processor')

async function registerServiceWithGateway(input) {
  const response = await fetch(`${input.gatewayUrl.replace(/\/$/, '')}/services/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.registrySecret ? { 'x-service-registry-secret': input.registrySecret } : {})
    },
    body: JSON.stringify(input.service)
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Service registration failed (${response.status}): ${body}`)
  }

  return response.json()
}

const app = express()
app.use(express.json({ limit: '10mb' }))
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// ---------------------------------------------------------------------------
// POST /api/uploads/upload
// Client uploads file directly to backend, which stores it in Supabase Storage
// ---------------------------------------------------------------------------
app.post('/api/uploads/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'file required (multipart/form-data field `file`)' })
    const filename = file.originalname || `${Date.now()}.bin`
    const uploadId = req.body.uploadId || uuidv4()

    const sha = crypto.createHash('sha256').update(file.buffer).digest('hex')

    let storageResult = null
    try {
      storageResult = await uploadBufferToSupabase(file.buffer, filename, file.mimetype || 'application/octet-stream')
    } catch (pErr) {
      console.warn('Supabase upload failed:', pErr.message)
      return res.status(500).json({ error: 'supabase_upload_failed', message: pErr.message })
    }

    let hfResult = null
    try {
      hfResult = await analyzeImageWithHuggingFace(file.buffer, file.mimetype || 'application/octet-stream')
    } catch (hfErr) {
      console.warn('HF failed:', hfErr.message)
      hfResult = { error: hfErr.message }
    }

    await pool.query(
      `INSERT INTO media (upload_id, object_key, sha256, metadata, hf_result, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (upload_id) DO UPDATE
         SET object_key = EXCLUDED.object_key,
             sha256     = EXCLUDED.sha256,
             metadata   = EXCLUDED.metadata,
             hf_result  = EXCLUDED.hf_result`,
      [uploadId, storageResult.objectKey, sha, JSON.stringify({ filename, storageResult }), JSON.stringify(hfResult)]
    )

    res.json({ ok: true, uploadId, objectKey: storageResult.objectKey, url: storageResult.publicUrl, sha, hfResult })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ---------------------------------------------------------------------------
// Chunked upload support
// ---------------------------------------------------------------------------
const TMP_DIR = path.join(__dirname, '..', 'tmp_uploads')
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

app.post('/api/uploads/chunk/init', express.json(), async (req, res) => {
  const { filename, metadata } = req.body || {}
  if (!filename) return res.status(400).json({ error: 'filename required' })
  const uploadId = uuidv4()
  const tmpPath = path.join(TMP_DIR, `${uploadId}.part`)
  fs.writeFileSync(tmpPath, '')

  await pool.query(
    `INSERT INTO media (upload_id, object_key, metadata, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [uploadId, null, JSON.stringify(metadata || {})]
  )

  res.json({ uploadId, chunkSize: 5 * 1024 * 1024 })
})

app.put('/api/uploads/chunk/:uploadId', express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
  try {
    const { uploadId } = req.params
    const chunk = req.body
    if (!uploadId || !chunk) return res.status(400).json({ error: 'missing' })
    const tmpPath = path.join(TMP_DIR, `${uploadId}.part`)
    fs.appendFileSync(tmpPath, chunk)
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/uploads/chunk/complete', express.json(), async (req, res) => {
  try {
    const { uploadId, filename } = req.body
    if (!uploadId || !filename) return res.status(400).json({ error: 'uploadId and filename required' })
    const tmpPath = path.join(TMP_DIR, `${uploadId}.part`)
    if (!fs.existsSync(tmpPath)) return res.status(404).json({ error: 'not_found' })

    const buffer = fs.readFileSync(tmpPath)
    const sha = crypto.createHash('sha256').update(buffer).digest('hex')
    const storageResult = await uploadBufferToSupabase(buffer, filename, 'application/octet-stream')

    let hfResult = null
    try {
      hfResult = await analyzeImageWithHuggingFace(buffer, 'application/octet-stream')
    } catch (hfErr) {
      console.warn('HF failed:', hfErr.message)
      hfResult = { error: hfErr.message }
    }

    await pool.query(
      `UPDATE media
       SET object_key = $1, sha256 = $2, hf_result = $3
       WHERE upload_id = $4`,
      [storageResult.objectKey, sha, JSON.stringify(hfResult), uploadId]
    )

    fs.unlinkSync(tmpPath)
    res.json({ ok: true, uploadId, objectKey: storageResult.objectKey, url: storageResult.publicUrl, sha, hfResult })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  await ensureSchema()
  const port = Number(process.env.PORT || 4000)
  const serviceName = process.env.SERVICE_NAME || 'media-ingest'
  const serviceAddress = process.env.SERVICE_URL || `http://127.0.0.1:${port}`
  const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:3100'

  app.listen(port, () => console.log('media-ingest listening on', port))

  void registerServiceWithGateway({
    gatewayUrl,
    service: {
      name: serviceName,
      address: serviceAddress,
      healthUrl: `${serviceAddress.replace(/\/$/, '')}/health`,
      description: 'RoadWatch media ingest prototype'
    },
    registrySecret: process.env.SERVICE_REGISTRY_SECRET
  }).catch((error) => {
    console.warn('[media-ingest] service registration failed:', error instanceof Error ? error.message : String(error))
  })
}

start().catch((e) => {
  console.error('startup failed', e)
  process.exit(1)
})