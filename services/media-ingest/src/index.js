const express = require('express')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })
const { pinBufferToPinata } = require('./pinata')
const { client, ensureSchema, types } = require('./db')
const { callHuggingFaceImageEmbedding, upsertToVectorDB } = require('./processor')
const app = express()
app.use(express.json({ limit: '10mb' }))

// Client uploads file directly to backend (MVP) which pins to Pinata
app.post('/api/uploads/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'file required (multipart/form-data field `file`)' })
    const filename = file.originalname || `${Date.now()}.bin`
    const uploadId = req.body.uploadId || uuidv4()

    // compute sha256
    const sha = crypto.createHash('sha256').update(file.buffer).digest('hex')

    // pin to Pinata
    let pinResult = null
    try {
      pinResult = await pinBufferToPinata(file.buffer, filename)
    } catch (pErr) {
      console.warn('Pinata pin failed:', pErr.message)
      return res.status(500).json({ error: 'pinata_failed', message: pErr.message })
    }

    // Call HF to get embedding
    let hfResult = null
    try {
      const embedding = await callHuggingFaceImageEmbedding(file.buffer)
      hfResult = { embeddingLength: Array.isArray(embedding) ? embedding.length : null }
      // upsert to pinecone
      await upsertToVectorDB(uploadId, Array.isArray(embedding) ? embedding : [])
    } catch (hfErr) {
      console.warn('HF failed:', hfErr.message)
      hfResult = { error: hfErr.message }
    }

    // persist metadata (Cassandra upsert via INSERT)
    await client.execute(`INSERT INTO ${client.keyspace}.media (upload_id, object_key, sha256, metadata, hf_result, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
      uploadId,
      pinResult.IpfsHash,
      sha,
      JSON.stringify({ filename, pinResult }),
      JSON.stringify(hfResult),
      new Date()
    ], { prepare: true })

    res.json({ ok: true, uploadId, ipfs: pinResult.IpfsHash, sha, hfResult })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Chunked upload support (client uploads chunks via PUT)
const TMP_DIR = path.join(__dirname, '..', 'tmp_uploads')
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

app.post('/api/uploads/chunk/init', express.json(), async (req, res) => {
  const { filename, totalSize, metadata } = req.body || {}
  if (!filename) return res.status(400).json({ error: 'filename required' })
  const uploadId = uuidv4()
  const tmpPath = path.join(TMP_DIR, `${uploadId}.part`)
  fs.writeFileSync(tmpPath, '')
  // store initial record
  await client.execute(`INSERT INTO ${client.keyspace}.media (upload_id, object_key, metadata, created_at) VALUES (?, ?, ?, ?)`, [uploadId, null, JSON.stringify(metadata || {}), new Date()], { prepare: true })
  res.json({ uploadId, chunkSize: 5 * 1024 * 1024 })
})

// Accept raw chunk and append to temp file
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
    // pin to Pinata
    const pinResult = await pinBufferToPinata(buffer, filename)
    // hf embedding and upsert
    let hfResult = null
    try {
      const embedding = await callHuggingFaceImageEmbedding(buffer)
      hfResult = { embeddingLength: Array.isArray(embedding) ? embedding.length : null }
      await upsertToVectorDB(uploadId, Array.isArray(embedding) ? embedding : [])
    } catch (hfErr) {
      console.warn('HF failed:', hfErr.message)
      hfResult = { error: hfErr.message }
    }
    await client.execute(`INSERT INTO ${client.keyspace}.media (upload_id, object_key, sha256, hf_result, created_at) VALUES (?, ?, ?, ?, ?)`, [uploadId, pinResult.IpfsHash, sha, JSON.stringify(hfResult), new Date()], { prepare: true })
    fs.unlinkSync(tmpPath)
    res.json({ ok: true, uploadId, ipfs: pinResult.IpfsHash, sha, hfResult })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Pinata webhook receiver: when Pinata confirms a pin, it can POST here.
// This endpoint will fetch the file from Pinata gateway and trigger embedding/upsert.
// Pinata webhook receiver with HMAC verification and retry storage
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
    } catch (e) {
      console.warn('invalid json webhook body')
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
      // store retry record
      await client.execute(`INSERT INTO ${client.keyspace}.pinata_webhook_retries (id, cid, payload, attempts, last_error, created_at, next_attempt) VALUES (?, ?, ?, ?, ?, ?, ?)`, [types.TimeUuid.now(), cid, JSON.stringify(body), 0, `fetch_failed:${fetchRes.status}`, new Date(), new Date()], { prepare: true })
      return res.status(202).json({ ok: false, queued: true })
    }
    const arrayBuf = await fetchRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const sha = crypto.createHash('sha256').update(buffer).digest('hex')

    // run HF embedding
    let hfResult = null
    try {
      const embedding = await callHuggingFaceImageEmbedding(buffer)
      hfResult = { embeddingLength: Array.isArray(embedding) ? embedding.length : null }
      await upsertToVectorDB(cid, Array.isArray(embedding) ? embedding : [])
    } catch (hfErr) {
      console.warn('HF failed on webhook pin:', hfErr.message)
      // record for retry later
      await client.execute(`INSERT INTO ${client.keyspace}.pinata_webhook_retries (id, cid, payload, attempts, last_error, created_at, next_attempt) VALUES (?, ?, ?, ?, ?, ?, ?)`, [types.TimeUuid.now(), cid, JSON.stringify(body), 0, `hf_failed:${hfErr.message}`, new Date(), new Date()], { prepare: true })
      return res.status(202).json({ ok: false, queued: true })
    }

    // update or insert metadata record linking cid
    await client.execute(`INSERT INTO ${client.keyspace}.media (upload_id, object_key, sha256, metadata, hf_result, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
      cid,
      cid,
      sha,
      JSON.stringify({ pinataWebhook: body }),
      JSON.stringify(hfResult),
      new Date()
    ], { prepare: true })

    res.json({ ok: true, cid, sha, hfResult })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Admin endpoint to retry failed webhook processing
app.post('/api/pinata/retry-failed', express.json(), async (req, res) => {
  const limit = Number(req.body?.limit || 20)
  try {
    const rowsRes = await client.execute(`SELECT id, cid, payload, attempts FROM ${client.keyspace}.pinata_webhook_retries WHERE next_attempt <= ? ALLOW FILTERING LIMIT ?`, [new Date(), limit], { prepare: true })
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
        await client.execute(`DELETE FROM ${client.keyspace}.pinata_webhook_retries WHERE id = ?`, [r.id], { prepare: true })
        await client.execute(`INSERT INTO ${client.keyspace}.media (upload_id, object_key, sha256, metadata, hf_result, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [cid, cid, sha, JSON.stringify({ retried: true }), JSON.stringify({ embeddingLength: Array.isArray(embedding) ? embedding.length : null }), new Date()], { prepare: true })
        results.push({ id: r.id, ok: true })
      } catch (err) {
        console.warn('retry failed', r.id, err.message)
        const next = new Date(Date.now() + 5 * 60 * 1000)
        await client.execute(`UPDATE ${client.keyspace}.pinata_webhook_retries SET attempts = ?, last_error = ?, next_attempt = ? WHERE id = ?`, [(r.attempts || 0) + 1, err.message, next, r.id], { prepare: true })
        results.push({ id: r.id, ok: false, error: err.message })
      }
    }
    res.json({ processed: results.length, results })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

async function start() {
  await ensureSchema()
  const port = process.env.PORT || 4000
  app.listen(port, () => console.log('media-ingest listening on', port))
}

start().catch((e) => {
  console.error('startup failed', e)
  process.exit(1)
})
