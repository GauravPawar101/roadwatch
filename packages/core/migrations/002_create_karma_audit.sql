CREATE TABLE IF NOT EXISTS karma_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  action_type TEXT,
  reference_id TEXT,
  score INTEGER,
  tier TEXT,
  penalty_count INTEGER,
  last_penalty_at TIMESTAMPTZ,
  suspended_until TIMESTAMPTZ,
  ban_reason TEXT,
  daily_submission_count INTEGER,
  last_submission_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_karma_records_user_id ON karma_records(user_id);
CREATE INDEX IF NOT EXISTS idx_karma_records_tier ON karma_records(tier);
CREATE INDEX IF NOT EXISTS idx_karma_records_suspended_until ON karma_records(suspended_until);
CREATE INDEX IF NOT EXISTS idx_karma_records_score ON karma_records(score);

CREATE TABLE IF NOT EXISTS verification_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT,
  submission_id TEXT,
  auditor_id TEXT,
  reviewer_id TEXT,
  decision TEXT,
  check_type TEXT,
  check_result BOOLEAN,
  detail JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  action TEXT,
  reason TEXT,
  ai_confidence_score DOUBLE PRECISION,
  specialized_flag BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_audits_request_id ON verification_audits(request_id);
CREATE INDEX IF NOT EXISTS idx_verification_audits_submission_id ON verification_audits(submission_id);
CREATE INDEX IF NOT EXISTS idx_verification_audits_check_type ON verification_audits(check_type);
CREATE INDEX IF NOT EXISTS idx_verification_audits_reviewer_id ON verification_audits(reviewer_id);

CREATE TABLE IF NOT EXISTS karma_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  submission_id TEXT,
  reason TEXT,
  status TEXT,
  reviewer_id TEXT,
  decision TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_karma_appeals_user_id ON karma_appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_karma_appeals_status ON karma_appeals(status);