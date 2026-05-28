const crypto = require('crypto')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '')
}

function buildObjectKey(filename, hash) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return `uploads/${hash}-${safeName}`
}

function encodeObjectKey(objectKey) {
  return objectKey.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function getEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key]
    if (value) return value
  }
  return undefined
}

function createSupabaseS3Client(supabaseUrl, accessKeyId, secretAccessKey) {
  return new S3Client({
    region: 'us-east-1',
    endpoint: `${trimTrailingSlash(supabaseUrl)}/storage/v1/s3`,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  })
}

async function uploadBufferToSupabase(buffer, filename = 'file', mimeType = 'application/octet-stream') {
  const supabaseUrl = getEnvValue('SUPABASE_URL', 'SUPABASE_PROJECT_URL')
  const bucket = getEnvValue('SUPABASE_STORAGE_BUCKET') || 'roadwatch-media'
  const accessKeyId = getEnvValue('SUPABASE_S3_ACCESS_KEY_ID', 'SUPABASE_s3_ACCESS_KEY_ID')
  const secretAccessKey = getEnvValue('SUPABASE_S3_SECRET_ACCESS_KEY_ID', 'SUPABASE_s3_SECRET_ACCESS_KEY_ID')

  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const objectKey = buildObjectKey(filename, hash)

  if (!supabaseUrl || !accessKeyId || !secretAccessKey) {
    throw new Error('SUPABASE_URL, SUPABASE_S3_ACCESS_KEY_ID, and SUPABASE_S3_SECRET_ACCESS_KEY_ID must be set for media uploads')
  }

  const s3 = createSupabaseS3Client(supabaseUrl, accessKeyId, secretAccessKey)
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
    ACL: 'public-read'
  }))

  return {
    objectKey,
    publicUrl: `${trimTrailingSlash(supabaseUrl)}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectKey(objectKey)}`,
    hash
  }
}

module.exports = { uploadBufferToSupabase }