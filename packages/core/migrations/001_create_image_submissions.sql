CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS image_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT UNIQUE NOT NULL,
  uploader_id_encrypted TEXT,
  uploader_pseudonym TEXT,
  server_received_at TIMESTAMPTZ DEFAULT NOW(),
  exif_timestamp TIMESTAMPTZ,
  exif_latitude DOUBLE PRECISION,
  exif_longitude DOUBLE PRECISION,
  device_latitude DOUBLE PRECISION,
  device_longitude DOUBLE PRECISION,
  nonce TEXT,
  phash TEXT,
  verified_status TEXT DEFAULT 'PENDING',
  storage_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  fabric_tx_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_image_submissions_request_id ON image_submissions(request_id);
CREATE INDEX IF NOT EXISTS idx_image_submissions_uploader_pseudonym ON image_submissions(uploader_pseudonym);
CREATE INDEX IF NOT EXISTS idx_image_submissions_verified_status ON image_submissions(verified_status);
CREATE INDEX IF NOT EXISTS idx_image_submissions_server_received_at ON image_submissions(server_received_at);
CREATE INDEX IF NOT EXISTS idx_image_submissions_phash ON image_submissions(phash);
CREATE INDEX IF NOT EXISTS idx_image_submissions_created_by_id ON image_submissions(created_by_id);

CREATE TABLE IF NOT EXISTS server_nonces (
  nonce TEXT PRIMARY KEY,
  user_id TEXT,
  request_id TEXT,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_server_nonces_user_id ON server_nonces(user_id);
CREATE INDEX IF NOT EXISTS idx_server_nonces_expires_at ON server_nonces(expires_at);