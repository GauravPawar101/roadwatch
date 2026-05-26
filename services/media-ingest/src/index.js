const express = require('express')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })
const { pinBufferToPinata } = require('./pinata')
const { pool, ensureSchema } = require('./db')
const { callHuggingFaceImageEmbedding, upsertToVectorDB } = require('./processor')

const app = express()
app.use(express.json({ limit: '10mb' }))

// ---------------------------------------------------------------------------
// POST /api/uploads/upload
// Client uploads file directly to backend (MVP) which pins to Pinata
// ---------------------------------------------------------------------------
app.post('/api/uploads/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'file required (multipart/form-data field `file`)' })
    const filename = file.originalname || `${Date.now()}.bin`
    const uploadId = req.body.uploadId || uuidv4()

    const sha = crypto.createHash('sha256').update(file.buffer).digest('hex')

    let pinResult = null
    try {
      pinResult = await pinBufferToPinata(file.buffer, filename)
    } catch (pErr) {
      console.warn('Pinata pin failed:', pErr.message)
      return res.status(500).json({ error: 'pinata_failed', message: pErr.message })
    }

    let hfResult = null
    try {
      const embedding = await callHuggingFaceImageEmbedding(file.buffer)
      hfResult = { embeddingLength: Array.isArray(embedding) ? embedding.length : null }
      await upsertToVectorDB(uploadId, Array.isArray(embedding) ? embedding : [])
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
      [uploadId, pinResult.IpfsHash, sha, JSON.stringify({ filename, pinResult }), JSON.stringify(hfResult)]
    )

    res.json({ ok: true, uploadId, ipfs: pinResult.IpfsHash, sha, hfResult })
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
    const pinResult = await pinBufferToPinata(buffer, filename)

    let hfResult = null
    try {
      const embedding = await callHuggingFaceImageEmbedding(buffer)
      hfResult = { embeddingLength: Array.isArray(embedding) ? embedding.length : null }
      await upsertToVectorDB(uploadId, Array.isArray(embedding) ? embedding : [])
    } catch (hfErr) {
      console.warn('HF failed:', hfErr.message)
      hfResult = { error: hfErr.message }
    }

    await pool.query(
      `UPDATE media
       SET object_key = $1, sha256 = $2, hf_result = $3
       WHERE upload_id = $4`,
      [pinResult.IpfsHash, sha, JSON.stringify(hfResult), uploadId]
    )

    fs.unlinkSync(tmpPath)
    res.json({ ok: true, uploadId, ipfs: pinResult.IpfsHash, sha, hfResult })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/pinata/webhook
// Pinata confirms a pin → fetch from gateway, embed, store
// ---------------------------------------------------------------------------
app.post('/api/pinata/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const secret = process.env.PINATA_WEBHOOK_SECRET
    const sigHeader = req.headers['x-pinata-signature'] || req.headers['x-pinata-signature-256']
    const raw = req.body
    if (secret && sigHeader) {
      const h = crypto.createHmac('sha256', secret).update(raw).digest('hex')
      if (h !== String(sigHeader)) {
        console.warn('pinata webhook verification failed')
        return res.status(401).json({ error: 'signature_mismatch' })
      }
    }

    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return res.status(400).json({ error: 'invalid_json' })
    }

    const cid = body.IpfsHash || (body.pin && body.pin.ipfsHash) || (body.event && body.event.data && body.event.data.ipfsHash)
    if (!cid) {
      console.warn('pinata webhook missing cid', body)
      return res.status(400).json({ error: 'cid_missing' })
    }

    const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`
    const fetchRes = await require('node-fetch')(gatewayUrl)
    if (!fetchRes.ok) {
      await pool.query(
        `INSERT INTO pinata_webhook_retries (id, cid, payload, attempts, last_error, created_at, next_attempt)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [uuidv4(), cid, JSON.stringify(body), 0, `fetch_failed:${fetchRes.status}`]
      )
      return res.status(202).json({ ok: false, queued: true })
    }

    const arrayBuf = await fetchRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const sha = crypto.createHash('sha256').update(buffer).digest('hex')

    let hfResult = null
    try {
      const embedding = await callHuggingFaceImageEmbedding(buffer)
      hfResult = { embeddingLength: Array.isArray(embedding) ? embedding.length : null }
      await upsertToVectorDB(cid, Array.isArray(embedding) ? embedding : [])
    } catch (hfErr) {
      console.warn('HF failed on webhook pin:', hfErr.message)
      await pool.query(
        `INSERT INTO pinata_webhook_retries (id, cid, payload, attempts, last_error, created_at, next_attempt)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [uuidv4(), cid, JSON.stringify(body), 0, `hf_failed:${hfErr.message}`]
      )
      return res.status(202).json({ ok: false, queued: true })
    }

    await pool.query(
      `INSERT INTO media (upload_id, object_key, sha256, metadata, hf_result, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (upload_id) DO UPDATE
         SET object_key = EXCLUDED.object_key,
             sha256     = EXCLUDED.sha256,
             metadata   = EXCLUDED.metadata,
             hf_result  = EXCLUDED.hf_result`,
      [cid, cid, sha, JSON.stringify({ pinataWebhook: body }), JSON.stringify(hfResult)]
    )

    res.json({ ok: true, cid, sha, hfResult })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/pinata/retry-failed
// Admin endpoint to retry failed webhook processing
// ---------------------------------------------------------------------------
app.post('/api/pinata/retry-failed', express.json(), async (req, res) => {
  const limit = Number(req.body?.limit || 20)
  try {
    // Replaces ALLOW FILTERING time-range scan with a proper indexed query
    const rowsRes = await pool.query(
      `SELECT id, cid, payload, attempts
       FROM pinata_webhook_retries
       WHERE next_attempt <= NOW()
       ORDER BY next_attempt
       LIMIT $1`,
      [limit]
    )
    const rows = rowsRes.rows
    const results = []

    for (const r of rows) {
      try {
        const cid = r.cid
        const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`
        const fetchRes = await require('node-fetch')(gatewayUrl)
        if (!fetchRes.ok) throw new Error(`fetch ${fetchRes.status}`)
        const arrayBuf = await fetchRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuf)
        const sha = crypto.createHash('sha256').update(buffer).digest('hex')
        const embedding = await callHuggingFaceImageEmbedding(buffer)
        await upsertToVectorDB(cid, Array.isArray(embedding) ? embedding : [])

        await pool.query('DELETE FROM pinata_webhook_retries WHERE id = $1', [r.id])
        await pool.query(
          `INSERT INTO media (upload_id, object_key, sha256, metadata, hf_result, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (upload_id) DO UPDATE
             SET object_key = EXCLUDED.object_key,
                 sha256     = EXCLUDED.sha256,
                 metadata   = EXCLUDED.metadata,
                 hf_result  = EXCLUDED.hf_result`,
          [cid, cid, sha, JSON.stringify({ retried: true }), JSON.stringify({ embeddingLength: Array.isArray(embedding) ? embedding.length : null })]
        )

        results.push({ id: r.id, ok: true })
      } catch (err) {
        console.warn('retry failed', r.id, err.message)
        await pool.query(
          `UPDATE pinata_webhook_retries
           SET attempts     = $1,
               last_error   = $2,
               next_attempt = NOW() + INTERVAL '5 minutes'
           WHERE id = $4`,
          [(r.attempts || 0) + 1, err.message, r.id]
        )
        results.push({ id: r.id, ok: false, error: err.message })
      }
    }

    res.json({ processed: results.length, results })
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
  const port = process.env.PORT || 4000
  app.listen(port, () => console.log('media-ingest listening on', port))
}

start().catch((e) => {
  console.error('startup failed', e)
  process.exit(1)
})