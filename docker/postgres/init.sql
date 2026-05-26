-- =============================================================
--  RoadWatch – PostgreSQL schema
--  Replaces: cassandra init.cql + roadwatch PoC CQL
--  Run once against an empty `roadwatch` database.
-- =============================================================

-- Enable pgcrypto for gen_random_uuid() on older PG versions.
-- On PG 13+ gen_random_uuid() is built-in; this is a no-op if already loaded.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
--  Users
--  Canonical user record. Phone lookup is via unique index below
--  (replaces the Cassandra users_by_phonehash secondary table).
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id              text        PRIMARY KEY,
  phone           text,
  phone_hash      text,
  identifier      text,
  email           text,
  username        text,
  password_hash   text,
  signup_method   text,
  role            text,
  districts       text[],
  zones           text[],
  fabric_verified boolean     DEFAULT false,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Replaces roadwatch.users_by_phonehash lookup table
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_hash_idx ON users (phone_hash)
  WHERE phone_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- =============================================================
--  Complaints
-- =============================================================
CREATE TABLE IF NOT EXISTS complaints (
  id               text        PRIMARY KEY,
  road_id          text,
  district         text,
  zone             text,
  status           text        NOT NULL DEFAULT 'FILED',
  description      text,
  metadata         jsonb       NOT NULL DEFAULT '{}',
  details_hash     text,
  lat              double precision,
  lng              double precision,
  authority_id     text,
  authority_org    text,
  report_count     integer     NOT NULL DEFAULT 1,
  anchored_tx_hash text,
  anchored_at      timestamptz,
  fabric_txid      text,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaints_road_id_status_idx ON complaints (road_id, status);
CREATE INDEX IF NOT EXISTS complaints_district_idx       ON complaints (district);
CREATE INDEX IF NOT EXISTS complaints_status_idx         ON complaints (status);

-- =============================================================
--  Complaint attachments
-- =============================================================
CREATE TABLE IF NOT EXISTS complaint_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id text        NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  kind         text        NOT NULL DEFAULT 'PHOTO',
  file_path    text,
  file_mime    text,
  file_sha256  text,
  note         jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaint_attachments_complaint_id_idx
  ON complaint_attachments (complaint_id);

-- =============================================================
--  Complaint assignments
-- =============================================================
CREATE TABLE IF NOT EXISTS complaint_assignments (
  complaint_id             text        PRIMARY KEY REFERENCES complaints (id) ON DELETE CASCADE,
  district                 text,
  contractor_id            text,
  inspector_id             text,
  assigned_at              timestamptz,
  expected_resolution_days integer
);

-- =============================================================
--  Road assignments
-- =============================================================
CREATE TABLE IF NOT EXISTS road_assignments (
  id            text        PRIMARY KEY,
  road_id       text,
  contractor_id text,
  assigned_at   timestamptz,
  metadata      jsonb       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS road_assignments_road_id_idx        ON road_assignments (road_id);
CREATE INDEX IF NOT EXISTS road_assignments_contractor_id_idx  ON road_assignments (contractor_id);

-- =============================================================
--  Audit log
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id      text,
  actor_phone_hash   text,
  actor_phone_masked text,
  action             text,
  target_type        text,
  target_id          text,
  details            jsonb       NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_target_id_idx      ON audit_log (target_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_idx  ON audit_log (actor_user_id);

-- =============================================================
--  Contractors
-- =============================================================
CREATE TABLE IF NOT EXISTS contractors (
  id           text        PRIMARY KEY,
  name         text,
  contact_info text,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  Roads catalog
-- =============================================================
CREATE TABLE IF NOT EXISTS roads_catalog (
  id          text        PRIMARY KEY,
  name        text,
  district_id text,
  authority_id text,
  road_type   text,
  geometry    jsonb,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS roads_catalog_district_id_idx ON roads_catalog (district_id);

-- =============================================================
--  Geography: countries / states / districts
-- =============================================================
CREATE TABLE IF NOT EXISTS countries (
  code             text PRIMARY KEY,
  name             text NOT NULL,
  default_time_zone text
);

CREATE TABLE IF NOT EXISTS states (
  country_code text NOT NULL,
  code         text NOT NULL,
  name         text,
  PRIMARY KEY (country_code, code)
);

CREATE TABLE IF NOT EXISTS districts (
  id       text PRIMARY KEY,
  name     text,
  metadata jsonb NOT NULL DEFAULT '{}'
);

-- Full district details (replaces districts_by_state Cassandra table)
CREATE TABLE IF NOT EXISTS districts_by_state (
  country_code      text NOT NULL,
  state_code        text NOT NULL,
  code              text NOT NULL,
  id                text,
  name              text,
  top_left_lat      double precision,
  top_left_lng      double precision,
  bottom_right_lat  double precision,
  bottom_right_lng  double precision,
  min_zoom          integer,
  max_zoom          integer,
  tile_style_url    text,
  PRIMARY KEY (country_code, state_code, code)
);

CREATE INDEX IF NOT EXISTS districts_by_state_id_idx ON districts_by_state (id);

-- =============================================================
--  Analytics events
-- =============================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text,
  payload    jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analytics_events_event_type_idx ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at);

-- =============================================================
--  Event logs
-- =============================================================
CREATE TABLE IF NOT EXISTS event_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text,
  entity_id   text,
  entity_type text,
  event_data  jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_logs_entity_id_idx ON event_logs (entity_id);

-- =============================================================
--  Notifications
-- =============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text,
  type       text,
  title      text,
  body       text,
  data       jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id);

CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id text,
  channel         text,
  status          text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_delivery_logs_notification_id_idx
  ON notification_delivery_logs (notification_id);

-- =============================================================
--  Authority action logs
-- =============================================================
CREATE TABLE IF NOT EXISTS authority_action_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id text        REFERENCES complaints (id) ON DELETE CASCADE,
  authority_id text,
  action_type  text,
  action_data  jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS authority_action_logs_complaint_id_idx ON authority_action_logs (complaint_id);
CREATE INDEX IF NOT EXISTS authority_action_logs_authority_id_idx ON authority_action_logs (authority_id);

-- =============================================================
--  Authority directory
-- =============================================================
CREATE TABLE IF NOT EXISTS authority_directory (
  authority_id text        PRIMARY KEY,
  name         text,
  department   text,
  public_phone text,
  public_email text,
  website      text,
  address      text,
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  Image submissions
-- =============================================================
CREATE TABLE IF NOT EXISTS image_submissions (
  id                    text        PRIMARY KEY,
  request_id            text,
  uploader_id_encrypted text,
  uploader_pseudonym    text,
  server_received_at    timestamptz,
  exif_timestamp        timestamptz,
  exif_latitude         double precision,
  exif_longitude        double precision,
  device_latitude       double precision,
  device_longitude      double precision,
  nonce                 text,
  phash                 text,
  verified_status       text,
  storage_path          text,
  metadata              jsonb       NOT NULL DEFAULT '{}',
  created_by_id         text,
  created_at            timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  Karma records
-- =============================================================
CREATE TABLE IF NOT EXISTS karma_records (
  user_id                text        PRIMARY KEY,
  score                  integer     NOT NULL DEFAULT 0,
  tier                   text,
  daily_submission_count integer     NOT NULL DEFAULT 0,
  last_submission_date   text,
  penalty_count          integer     NOT NULL DEFAULT 0,
  last_penalty_at        timestamptz,
  suspended_until        timestamptz,
  ban_reason             text,
  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  Verification audits
-- =============================================================
CREATE TABLE IF NOT EXISTS verification_audits (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text,
  check_type    text,
  check_result  boolean,
  detail        text,
  reviewer_id   text,
  action        text,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS verification_audits_submission_id_idx ON verification_audits (submission_id);

-- =============================================================
--  Server nonces
-- =============================================================
CREATE TABLE IF NOT EXISTS server_nonces (
  nonce      text        PRIMARY KEY,
  user_id    text,
  request_id text,
  issued_at  timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz,
  used       boolean     NOT NULL DEFAULT false,
  used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS server_nonces_expires_at_idx ON server_nonces (expires_at);

-- =============================================================
--  User privacy profiles
-- =============================================================
CREATE TABLE IF NOT EXISTS user_privacy_profiles (
  user_id          text        PRIMARY KEY,
  is_admin         boolean     NOT NULL DEFAULT false,
  is_authority     boolean     NOT NULL DEFAULT false,
  is_contractor    boolean     NOT NULL DEFAULT false,
  is_citizen       boolean     NOT NULL DEFAULT false,
  can_view_user_ids boolean    NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  Access logs
-- =============================================================
CREATE TABLE IF NOT EXISTS access_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        text,
  resource_type  text,
  resource_id    text,
  action         text,
  accessed_fields text,
  ip_address     text,
  user_agent     text,
  status         text,
  reason_blocked text,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_logs_user_id_idx    ON access_logs (user_id);
CREATE INDEX IF NOT EXISTS access_logs_resource_id_idx ON access_logs (resource_id);

-- =============================================================
--  OTP sessions
-- =============================================================
CREATE TABLE IF NOT EXISTS otp_sessions (
  id         text        PRIMARY KEY,
  user_id    text,
  code       text,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS otp_sessions_user_id_idx    ON otp_sessions (user_id);
CREATE INDEX IF NOT EXISTS otp_sessions_expires_at_idx ON otp_sessions (expires_at);

-- =============================================================
--  API idempotency keys
--  Stores request fingerprints and response payloads so retries
--  can be safely replayed without duplicating side effects.
-- =============================================================
CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  scope           text        NOT NULL,
  idempotency_key text        NOT NULL,
  request_hash    text        NOT NULL,
  response_code   integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS api_idempotency_keys_created_at_idx
  ON api_idempotency_keys (created_at);