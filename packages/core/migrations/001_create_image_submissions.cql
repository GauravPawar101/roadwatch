/* Create image_submissions and server_nonces for Cassandra */
CREATE TABLE IF NOT EXISTS image_submissions (
  id text PRIMARY KEY,
  request_id text,
  uploader_id_encrypted text,
  uploader_pseudonym text,
  server_received_at bigint,
  exif_timestamp bigint,
  exif_latitude double,
  exif_longitude double,
  device_latitude double,
  device_longitude double,
  nonce text,
  phash text,
  verified_status text,
  storage_path text,
  metadata text,
  fabric_tx_id text,
  created_at bigint,
  created_by_id text
);

CREATE INDEX IF NOT EXISTS idx_image_submissions_request_id ON image_submissions(request_id);
CREATE INDEX IF NOT EXISTS idx_image_submissions_uploader_pseudonym ON image_submissions(uploader_pseudonym);
CREATE INDEX IF NOT EXISTS idx_image_submissions_verified_status ON image_submissions(verified_status);
CREATE INDEX IF NOT EXISTS idx_image_submissions_server_received_at ON image_submissions(server_received_at);
CREATE INDEX IF NOT EXISTS idx_image_submissions_phash ON image_submissions(phash);
CREATE INDEX IF NOT EXISTS idx_image_submissions_created_by_id ON image_submissions(created_by_id);

CREATE TABLE IF NOT EXISTS server_nonces (
  nonce text PRIMARY KEY,
  user_id text,
  request_id text,
  issued_at bigint,
  expires_at bigint,
  used boolean,
  used_at bigint
);

CREATE INDEX IF NOT EXISTS idx_server_nonces_user_id ON server_nonces(user_id);
CREATE INDEX IF NOT EXISTS idx_server_nonces_expires_at ON server_nonces(expires_at);
