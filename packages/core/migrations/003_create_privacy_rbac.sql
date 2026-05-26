CREATE TABLE IF NOT EXISTS user_privacy_profiles (
  user_id TEXT PRIMARY KEY,
  is_admin BOOLEAN DEFAULT FALSE,
  is_authority BOOLEAN DEFAULT FALSE,
  is_contractor BOOLEAN DEFAULT FALSE,
  is_citizen BOOLEAN DEFAULT FALSE,
  authority_jurisdiction TEXT,
  contractor_assignment TEXT,
  can_view_user_ids BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_privacy_profiles_is_admin ON user_privacy_profiles(is_admin);
CREATE INDEX IF NOT EXISTS idx_user_privacy_profiles_is_authority ON user_privacy_profiles(is_authority);
CREATE INDEX IF NOT EXISTS idx_user_privacy_profiles_is_citizen ON user_privacy_profiles(is_citizen);

CREATE TABLE IF NOT EXISTS access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  action TEXT,
  accessed_fields JSONB DEFAULT '[]'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  status TEXT,
  reason_blocked TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource_type ON access_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource_id ON access_logs(resource_id);

CREATE TABLE IF NOT EXISTS encryption_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id TEXT,
  uploader_id_encrypted TEXT,
  encryption_key_version INTEGER,
  encrypted_at TIMESTAMPTZ,
  decrypted_by_admin_id TEXT,
  decrypted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_encryption_metadata_submission_id ON encryption_metadata(submission_id);