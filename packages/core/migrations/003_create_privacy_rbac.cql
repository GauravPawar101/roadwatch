/* Create privacy profiles, access logs, and encryption metadata for Cassandra */
CREATE TABLE IF NOT EXISTS user_privacy_profiles (
  user_id text PRIMARY KEY,
  is_admin boolean,
  is_authority boolean,
  is_contractor boolean,
  is_citizen boolean,
  authority_jurisdiction text,
  contractor_assignment text,
  can_view_user_ids boolean,
  created_at bigint,
  updated_at bigint
);

CREATE INDEX IF NOT EXISTS idx_user_privacy_profiles_is_admin ON user_privacy_profiles(is_admin);
CREATE INDEX IF NOT EXISTS idx_user_privacy_profiles_is_authority ON user_privacy_profiles(is_authority);
CREATE INDEX IF NOT EXISTS idx_user_privacy_profiles_is_citizen ON user_privacy_profiles(is_citizen);

CREATE TABLE IF NOT EXISTS access_logs (
  id text PRIMARY KEY,
  user_id text,
  resource_type text,
  resource_id text,
  action text,
  accessed_fields text,
  ip_address text,
  user_agent text,
  status text,
  reason_blocked text,
  created_at bigint
);

CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource_type ON access_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource_id ON access_logs(resource_id);

CREATE TABLE IF NOT EXISTS encryption_metadata (
  id text PRIMARY KEY,
  submission_id text,
  uploader_id_encrypted text,
  encryption_key_version int,
  encrypted_at bigint,
  decrypted_by_admin_id text,
  decrypted_at bigint
);

CREATE INDEX IF NOT EXISTS idx_encryption_metadata_submission_id ON encryption_metadata(submission_id);
