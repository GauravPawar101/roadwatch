/* Create karma records and verification audits for Cassandra */
CREATE TABLE IF NOT EXISTS karma_records (
  user_id text PRIMARY KEY,
  score int,
  tier text,
  penalty_count int,
  last_penalty_at bigint,
  suspended_until bigint,
  ban_reason text,
  daily_submission_count int,
  last_submission_date text,
  created_at bigint,
  updated_at bigint
);

CREATE INDEX IF NOT EXISTS idx_karma_records_tier ON karma_records(tier);
CREATE INDEX IF NOT EXISTS idx_karma_records_suspended_until ON karma_records(suspended_until);
CREATE INDEX IF NOT EXISTS idx_karma_records_score ON karma_records(score);

CREATE TABLE IF NOT EXISTS verification_audits (
  id text PRIMARY KEY,
  submission_id text,
  check_type text,
  check_result boolean,
  detail text,
  reviewer_id text,
  action text,
  reason text,
  created_at bigint
);

CREATE INDEX IF NOT EXISTS idx_verification_audits_submission_id ON verification_audits(submission_id);
CREATE INDEX IF NOT EXISTS idx_verification_audits_check_type ON verification_audits(check_type);
CREATE INDEX IF NOT EXISTS idx_verification_audits_reviewer_id ON verification_audits(reviewer_id);

CREATE TABLE IF NOT EXISTS karma_appeals (
  id text PRIMARY KEY,
  user_id text,
  submission_id text,
  reason text,
  status text,
  reviewer_id text,
  decision text,
  decided_at bigint,
  created_at bigint
);

CREATE INDEX IF NOT EXISTS idx_karma_appeals_user_id ON karma_appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_karma_appeals_status ON karma_appeals(status);
