-- =============================================================
--  RoadWatch – PostgreSQL schema
--  Replaces: cassandra init.cql + roadwatch PoC CQL
--  Run once against an empty `roadwatch` database.
-- =============================================================

-- Enable pgcrypto for gen_random_uuid() on older PG versions.
-- On PG 13+ gen_random_uuid() is built-in; this is a no-op if already loaded.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Enable pgvector for vector similarity search when the extension is installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
  ELSE
    RAISE NOTICE 'pgvector extension not available; embedding_vector column will be omitted';
  END IF;
END$$;

-- =============================================================
--  Users
--  Canonical user record. Phone lookup is via unique index below
--  (replaces the Cassandra users_by_phonehash secondary table).
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text,
  phone_masked    text,
  phone_hash      text,
  phone_enc       text,
  phone_last4     text,
  identifier      text,
  email           text,
  username        text,
  clerk_user_id   uuid,
  password_hash   text,
  signup_method   text,
  govt_id         text,
  role            text,
  account_status  text        NOT NULL DEFAULT 'ACTIVE',
  suspended_at    timestamptz,
  suspension_reason text,
  districts       text[],
  zones           text[],
  fabric_verified boolean     DEFAULT false,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Replaces roadwatch.users_by_phonehash lookup table.
-- Use a plain unique index so INSERT ... ON CONFLICT (phone_hash) can use it.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_hash_idx ON users (phone_hash);

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS phone_masked text,
  ADD COLUMN IF NOT EXISTS phone_enc text,
  ADD COLUMN IF NOT EXISTS phone_last4 text,
  ADD COLUMN IF NOT EXISTS clerk_user_id uuid,
  ADD COLUMN IF NOT EXISTS govt_id text,
  ADD COLUMN IF NOT EXISTS karma_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS karma_updated_at timestamptz NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- =============================================================
--  Refresh tokens
-- =============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  is_revoked  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);

-- =============================================================
--  Complaints
-- =============================================================
CREATE TABLE IF NOT EXISTS complaints (
  id               uuid        PRIMARY KEY,
  road_id          text,
  phone_masked    text,
  district         text,
  zone             text,
  status           text        NOT NULL DEFAULT 'FILED',
  title            text,
  damage_type      text,
  severity         integer,
  description      text,
  metadata         jsonb       NOT NULL DEFAULT '{}',
  details_hash     text,
  lat              double precision,
  lng              double precision,
  authority_id     text,
  authority_org    text,
  report_count     integer     NOT NULL DEFAULT 1,
  event_status     text,
  anchored_tx_hash text,
  anchored_at      timestamptz,
  last_authority_action text,
  fabric_txid      text,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS phone_masked text,
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaints_road_id_status_idx ON complaints (road_id, status);
CREATE INDEX IF NOT EXISTS complaints_district_idx       ON complaints (district);
CREATE INDEX IF NOT EXISTS complaints_status_idx         ON complaints (status);
CREATE INDEX IF NOT EXISTS complaints_damage_type_idx    ON complaints (damage_type);
CREATE INDEX IF NOT EXISTS complaints_severity_idx       ON complaints (severity);
ALTER TABLE IF EXISTS complaints
  ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE INDEX IF NOT EXISTS complaints_user_id_idx        ON complaints (user_id);

-- =============================================================
--  Complaint attachments
-- =============================================================
CREATE TABLE IF NOT EXISTS complaint_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid        NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
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
  complaint_id             uuid        PRIMARY KEY REFERENCES complaints (id) ON DELETE CASCADE,
  district                 text,
  contractor_id            uuid,
  inspector_id             uuid,
  assigned_at              timestamptz,
  expected_resolution_days integer
);
 
-- Add missing assignment metadata columns used by application logic
ALTER TABLE IF EXISTS complaint_assignments
  ADD COLUMN IF NOT EXISTS assigned_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS contractor_user_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ASSIGNED',
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress_pct integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_note text,
  ADD COLUMN IF NOT EXISTS resolution_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_decision text,
  ADD COLUMN IF NOT EXISTS review_note text;

-- =============================================================
--  Complaint engagement
-- =============================================================
CREATE TABLE IF NOT EXISTS complaint_comments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid        NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_role    text        NOT NULL,
  parent_id    uuid        REFERENCES complaint_comments (id) ON DELETE CASCADE,
  body         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaint_comments_complaint_id_idx ON complaint_comments (complaint_id);

CREATE TABLE IF NOT EXISTS complaint_reactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid        NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reaction     text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (complaint_id, user_id)
);

CREATE INDEX IF NOT EXISTS complaint_reactions_complaint_id_idx ON complaint_reactions (complaint_id);

CREATE TABLE IF NOT EXISTS complaint_work_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid        NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  contractor_id uuid,
  user_id      uuid,
  phase        text        NOT NULL,
  progress_pct integer,
  note         text,
  report       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaint_work_logs_complaint_id_idx ON complaint_work_logs (complaint_id);

CREATE TABLE IF NOT EXISTS complaint_reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid        NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_role    text        NOT NULL,
  decision     text        NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS complaint_reviews_complaint_id_idx ON complaint_reviews (complaint_id);
-- =============================================================
--  Road assignments
-- =============================================================
CREATE TABLE IF NOT EXISTS road_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  road_id       text,
  contractor_id uuid,
  assigned_at   timestamptz,
  metadata      jsonb       NOT NULL DEFAULT '{}'
);
 
-- Ensure engine/tenure columns exist
ALTER TABLE IF EXISTS road_assignments
  ADD COLUMN IF NOT EXISTS engineer_user_id uuid,
  ADD COLUMN IF NOT EXISTS starts_on date,
  ADD COLUMN IF NOT EXISTS ends_on date;
CREATE INDEX IF NOT EXISTS road_assignments_road_id_idx        ON road_assignments (road_id);
CREATE INDEX IF NOT EXISTS road_assignments_contractor_id_idx  ON road_assignments (contractor_id);

-- =============================================================
--  Audit log
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id      uuid,
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
  id           uuid        PRIMARY KEY,
  name         text,
  contact_info text,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

-- Add missing contractor fields referenced by code
ALTER TABLE IF EXISTS contractors
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS contact_phone_masked text,
  ADD COLUMN IF NOT EXISTS districts text[],
  ADD COLUMN IF NOT EXISTS zones text[];

-- =============================================================
--  Roads catalog
-- =============================================================
CREATE TABLE IF NOT EXISTS roads_catalog (
  id          text        PRIMARY KEY,
  name        text,
  district_id text,
  authority_id text,
  road_type   text,
  total_length_km numeric,
  geometry    jsonb,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS roads_catalog
  ADD COLUMN IF NOT EXISTS total_length_km numeric;

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
  id               uuid PRIMARY KEY,
  country_code     text,
  state_code       text,
  code             text,
  name             text,
  top_left_lat     double precision,
  top_left_lng     double precision,
  bottom_right_lat double precision,
  bottom_right_lng double precision,
  min_zoom         integer,
  max_zoom         integer,
  tile_style_url   text,
  metadata         jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE IF EXISTS districts
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS top_left_lat double precision,
  ADD COLUMN IF NOT EXISTS top_left_lng double precision,
  ADD COLUMN IF NOT EXISTS bottom_right_lat double precision,
  ADD COLUMN IF NOT EXISTS bottom_right_lng double precision,
  ADD COLUMN IF NOT EXISTS min_zoom integer,
  ADD COLUMN IF NOT EXISTS max_zoom integer,
  ADD COLUMN IF NOT EXISTS tile_style_url text;

CREATE INDEX IF NOT EXISTS districts_country_state_idx ON districts (country_code, state_code);
CREATE INDEX IF NOT EXISTS districts_code_idx ON districts (code);

-- Full district details (replaces districts_by_state Cassandra table)
CREATE TABLE IF NOT EXISTS districts_by_state (
  country_code      text NOT NULL,
  state_code        text NOT NULL,
  code              text NOT NULL,
  id                uuid,
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

ALTER TABLE IF EXISTS analytics_events
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS complaint_id uuid,
  ADD COLUMN IF NOT EXISTS contractor_id uuid,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS zone text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS properties jsonb;

CREATE INDEX IF NOT EXISTS analytics_events_event_type_idx ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at);

-- =============================================================
--  Embeddings (vector support)
-- =============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    EXECUTE $sql$
      CREATE TABLE IF NOT EXISTS embeddings (
        upload_id TEXT PRIMARY KEY,
        embedding JSONB,
        embedding_vector vector(1536),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE TABLE IF NOT EXISTS embeddings (
        upload_id TEXT PRIMARY KEY,
        embedding JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    $sql$;
  END IF;
END$$;

-- Media ingest records (stored as JSONB because the application reads/writes structured payloads)
CREATE TABLE IF NOT EXISTS media (
  upload_id   TEXT PRIMARY KEY,
  object_key  TEXT,
  sha256      TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  hf_result   JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ivfflat index for approximate nearest neighbor search (requires pgvector)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'embeddings_embedding_vector_idx') THEN
      EXECUTE 'CREATE INDEX embeddings_embedding_vector_idx ON embeddings USING ivfflat (embedding_vector) WITH (lists = 100)';
    END IF;
  ELSE
    RAISE NOTICE 'pgvector not available; skipping embeddings ivfflat index creation';
  END IF;
END$$;

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
  user_id    uuid,
  recipient_role text,
  type       text,
  title      text,
  body       text,
  data       jsonb       NOT NULL DEFAULT '{}',
  district   text,
  zone       text,
  road_id    text,
  critical   boolean    NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id);

-- Notification inbox/delivery tables used by gateway-api
CREATE TABLE IF NOT EXISTS notification_inbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  notification_id uuid NOT NULL,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid,
  notification_id uuid,
  channel         text,
  scheduled_for   timestamptz,
  batch_key       text,
  status          text DEFAULT 'PENDING',
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kafka_event_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           text        NOT NULL,
  message_key     text,
  headers         jsonb,
  payload         jsonb       NOT NULL,
  idempotency_key text,
  status          text        NOT NULL DEFAULT 'PENDING',
  attempts        integer     NOT NULL DEFAULT 0,
  available_at    timestamptz NOT NULL DEFAULT NOW(),
  sent_at         timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kafka_event_outbox_status_available_idx
  ON kafka_event_outbox (status, available_at, created_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id         uuid PRIMARY KEY,
  enabled_channels text[],
  dnd_enabled     boolean DEFAULT false,
  dnd_start_minutes integer DEFAULT 0,
  dnd_end_minutes integer DEFAULT 0,
  time_zone       text DEFAULT 'UTC',
  authority_batching text DEFAULT 'IMMEDIATE',
  digest_minutes  integer DEFAULT 60,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid,
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
  complaint_id uuid        REFERENCES complaints (id) ON DELETE CASCADE,
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
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              text,
  uploader_id_encrypted   text,
  uploader_pseudonym      text,
  server_received_at      timestamptz NOT NULL DEFAULT NOW(),
  exif_timestamp          timestamptz,
  exif_latitude           double precision,
  exif_longitude          double precision,
  device_latitude         double precision,
  device_longitude        double precision,
  nonce                   text,
  phash                   text,
  verified_status         text,
  storage_path            text,
  metadata                jsonb       NOT NULL DEFAULT '{}',
  created_by_id           uuid,
  created_at              timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  Karma records
-- =============================================================
CREATE TABLE IF NOT EXISTS karma_records (
  user_id                uuid        PRIMARY KEY,
  score                  integer     NOT NULL DEFAULT 0,
  tier                   text,
  daily_submission_count integer     NOT NULL DEFAULT 0,
  last_submission_date   date,
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
  submission_id uuid,
  check_type    text,
  check_result  text,
  detail        text,
  reviewer_id   uuid,
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
  user_id    uuid,
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
  user_id          uuid        PRIMARY KEY,
  is_admin         boolean     NOT NULL DEFAULT false,
  is_authority     boolean     NOT NULL DEFAULT false,
  is_contractor    boolean     NOT NULL DEFAULT false,
  is_citizen       boolean     NOT NULL DEFAULT false,
  can_view_user_ids boolean    NOT NULL DEFAULT false,
  authority_jurisdiction text[],
  contractor_assignment jsonb,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  RTI tables
-- =============================================================
CREATE TABLE IF NOT EXISTS rti_requests (
  id                      text        PRIMARY KEY,
  complaint_id            uuid,
  country_code            text,
  authority_name          text,
  subject                 text,
  request_text            text,
  status                  text,
  submitted_at            timestamptz,
  response_due_at         timestamptz,
  first_appeal_last_date  timestamptz,
  second_appeal_last_date timestamptz,
  tracking_token          uuid,
  public_share_token      uuid,
  public_opt_in_at        timestamptz,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rti_responses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rti_id       text        NOT NULL REFERENCES rti_requests (id) ON DELETE CASCADE,
  file_path    text,
  file_mime    text,
  file_sha256  text,
  notes        text,
  received_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rti_attachments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rti_id      text        NOT NULL REFERENCES rti_requests (id) ON DELETE CASCADE,
  kind        text,
  file_path   text,
  file_mime   text,
  file_sha256 text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rti_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rti_id      text        NOT NULL REFERENCES rti_requests (id) ON DELETE CASCADE,
  type        text,
  properties  jsonb       NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT NOW()
);

-- =============================================================
--  Services registry
-- =============================================================
CREATE TABLE IF NOT EXISTS services (
  id                text        PRIMARY KEY,
  address           text,
  health_url        text,
  description       text,
  metadata          jsonb,
  registered_at     timestamptz NOT NULL DEFAULT NOW(),
  last_health_check timestamptz,
  is_healthy        boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_services_name ON services (id);

-- =============================================================
--  Scheduler / offline tables
-- =============================================================
CREATE TABLE IF NOT EXISTS offline_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload     jsonb NOT NULL DEFAULT '{}',
  synced      boolean NOT NULL DEFAULT false,
  synced_at   timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS karma_ledger (
  user_id    uuid NOT NULL,
  delta      numeric NOT NULL,
  reason     text,
  ref_id     text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sla_tracking (
  complaint_id   uuid PRIMARY KEY REFERENCES complaints (id) ON DELETE CASCADE,
  contractor_id  uuid,
  breached       boolean NOT NULL DEFAULT false,
  breach_notified boolean NOT NULL DEFAULT false,
  sla_deadline   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_reports (
  report_date      date PRIMARY KEY,
  total_complaints integer,
  resolved_count   integer,
  pending_count    integer,
  report_data      jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaint_event_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        text NOT NULL,
  message_key  text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING',
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  available_at timestamptz NOT NULL DEFAULT NOW(),
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  sent_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_complaint_event_outbox_pending
  ON complaint_event_outbox (status, available_at, created_at);

CREATE TABLE IF NOT EXISTS processed_events (
  consumer_id   text NOT NULL,
  key           text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_id, key)
);

CREATE TABLE IF NOT EXISTS event_failures (
  consumer_id   text NOT NULL,
  key           text NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  last_error    text,
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_id, key)
);

CREATE TABLE IF NOT EXISTS complaint_merkle_proofs (
  complaint_id uuid PRIMARY KEY,
  merkle_root  text,
  merkle_proof text,
  fabric_txid  text,
  batch_id     text,
  anchored_at  timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaint_merkle_proofs_by_batch (
  batch_id     text NOT NULL,
  complaint_id uuid NOT NULL,
  merkle_root  text,
  merkle_proof text,
  fabric_txid  text,
  anchored_at  timestamptz DEFAULT NOW(),
  PRIMARY KEY (batch_id, complaint_id)
);

-- =============================================================
--  Access logs
-- =============================================================
CREATE TABLE IF NOT EXISTS access_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid,
  resource_type  text,
  resource_id    text,
  action         text,
  accessed_fields text[],
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
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid,
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