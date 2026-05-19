/*
  roadWatch - Cassandra initialization CQL
  Creates keyspace and essential tables for local development.
  This file is executed by the `cassandra-init` compose job after the
  Cassandra container becomes healthy.
*/

-- Keyspace
CREATE KEYSPACE IF NOT EXISTS roadwatch WITH replication = {
  'class': 'SimpleStrategy',
  'replication_factor': '1'
};

USE roadwatch;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text,
  phone text,
  phone_hash text,
  username text,
  password_hash text,
  signup_method text,
  role text,
  districts list<text>,
  zones list<text>,
  fabric_verified boolean,
  created_at timestamp,
  updated_at timestamp
);

-- Complaints
-- Complaints (canonical schema used by services and chaincode)
CREATE TABLE IF NOT EXISTS complaints (
  id text PRIMARY KEY,
  road_id text,
  district text,
  zone text,
  status text,
  description text,
  metadata text,
  details_hash text,
  lat double,
  lng double,
  authority_id text,
  authority_org text,
  report_count int,
  anchored_tx_hash text,
  anchored_at timestamp,
  fabric_txid text,
  created_at timestamp,
  updated_at timestamp
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id timeuuid PRIMARY KEY,
  actor_user_id text,
  actor_phone_hash text,
  actor_phone_masked text,
  action text,
  target_type text,
  target_id text,
  details text,
  created_at timestamp
);

-- Complaint assignments
CREATE TABLE IF NOT EXISTS complaint_assignments (
  complaint_id text PRIMARY KEY,
  district text,
  contractor_id text,
  inspector_id text,
  assigned_at timestamp,
  expected_resolution_days int
);

-- Contractors
CREATE TABLE IF NOT EXISTS contractors (
  id text PRIMARY KEY,
  name text,
  contact_info text
);

-- Image submissions
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
  created_by_id text
);

-- Analytics events (simple event store)
CREATE TABLE IF NOT EXISTS analytics_events (
  id timeuuid PRIMARY KEY,
  event_type text,
  payload text,
  created_at timestamp
);

-- Karma records
CREATE TABLE IF NOT EXISTS karma_records (
  user_id text PRIMARY KEY,
  score int,
  tier text,
  daily_submission_count int,
  last_submission_date text,
  penalty_count int,
  last_penalty_at bigint,
  suspended_until bigint,
  ban_reason text,
  created_at bigint,
  updated_at bigint
);

-- Verification audits
CREATE TABLE IF NOT EXISTS verification_audits (
  id timeuuid PRIMARY KEY,
  submission_id text,
  check_type text,
  check_result boolean,
  detail text,
  reviewer_id text,
  action text,
  reason text,
  created_at bigint
);

-- Server nonces
CREATE TABLE IF NOT EXISTS server_nonces (
  nonce text PRIMARY KEY,
  user_id text,
  request_id text,
  issued_at bigint,
  expires_at bigint,
  used boolean,
  used_at bigint
);

-- Privacy profiles
CREATE TABLE IF NOT EXISTS user_privacy_profiles (
  user_id text PRIMARY KEY,
  is_admin boolean,
  is_authority boolean,
  is_contractor boolean,
  is_citizen boolean,
  can_view_user_ids boolean,
  created_at bigint,
  updated_at bigint
);

-- Access logs
CREATE TABLE IF NOT EXISTS access_logs (
  id timeuuid PRIMARY KEY,
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

/* End of init.cql */
-- Cassandra initialization for Roadwatch PoC
CREATE KEYSPACE IF NOT EXISTS roadwatch WITH replication = {'class':'SimpleStrategy', 'replication_factor':1};

-- roadwatch.complaints already created above as `complaints` (canonical schema)
-- CREATE TABLE IF NOT EXISTS roadwatch.complaints is intentionally omitted to avoid
-- duplicate/conflicting table definitions. The single canonical `complaints` table
-- includes fields required by both on-ledger assets and off-ledger storage.

CREATE TABLE IF NOT EXISTS roadwatch.event_logs (
  id timeuuid PRIMARY KEY,
  event_type text,
  entity_id text,
  entity_type text,
  event_data text,
  created_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.notifications (
  id timeuuid PRIMARY KEY,
  user_id text,
  type text,
  title text,
  body text,
  data text,
  created_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.notification_delivery_logs (
  id timeuuid PRIMARY KEY,
  notification_id text,
  channel text,
  status text,
  created_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.authority_action_logs (
  id timeuuid PRIMARY KEY,
  complaint_id text,
  authority_id text,
  action_type text,
  action_data text,
  created_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.users (
  id text PRIMARY KEY,
  phone text,
  phone_hash text,
  identifier text,
  metadata text,
  created_at timestamp,
  updated_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.users_by_phonehash (
  phone_hash text PRIMARY KEY,
  user_id text
);

CREATE TABLE IF NOT EXISTS roadwatch.contractors (
  id text PRIMARY KEY,
  name text,
  metadata text,
  created_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.roads_catalog (
  id text PRIMARY KEY,
  name text,
  district_id text,
  metadata text
);

CREATE TABLE IF NOT EXISTS roadwatch.countries (
  code text PRIMARY KEY,
  name text,
  default_time_zone text
);

CREATE TABLE IF NOT EXISTS roadwatch.states (
  country_code text,
  code text,
  name text,
  PRIMARY KEY (country_code, code)
);

CREATE TABLE IF NOT EXISTS roadwatch.districts_by_state (
  country_code text,
  state_code text,
  code text,
  id text,
  name text,
  top_left_lat double,
  top_left_lng double,
  bottom_right_lat double,
  bottom_right_lng double,
  min_zoom int,
  max_zoom int,
  tile_style_url text,
  PRIMARY KEY ((country_code, state_code), code)
);

CREATE TABLE IF NOT EXISTS roadwatch.districts (
  id text PRIMARY KEY,
  name text,
  metadata text
);

CREATE TABLE IF NOT EXISTS roadwatch.road_assignments (
  id text PRIMARY KEY,
  road_id text,
  contractor_id text,
  assigned_at timestamp,
  metadata text
);

CREATE TABLE IF NOT EXISTS roadwatch.analytics_events (
  id timeuuid PRIMARY KEY,
  event_type text,
  payload text,
  created_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.otp_sessions (
  id text PRIMARY KEY,
  user_id text,
  code text,
  expires_at timestamp
);

CREATE TABLE IF NOT EXISTS roadwatch.authority_directory (
  authority_id text PRIMARY KEY,
  name text,
  department text,
  public_phone text,
  public_email text,
  website text,
  address text,
  updated_at timestamp
);
