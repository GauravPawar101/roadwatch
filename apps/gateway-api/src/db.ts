import pg from 'pg';
import { getEnv } from './env.js';
import { encryptPhone, hashPhone, maskPhone, normalizePhone, phoneLast4 } from './security/phone.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: getEnv().DATABASE_URL
});

export type Role = 'CE' | 'EE' | 'CITIZEN';

export type UserRow = {
  id: string;
  phone: string; // masked
  phoneHash: string | null;
  phoneEnc: string | null;
  phoneLast4: string | null;
  govtId: string | null;
  role: Role;
  districts: string[];
  zones: string[];
  created_at: Date;
};

export type ContractorRow = {
  id: string;
  name: string;
  registration_number: string | null;
  contact_phone_masked: string | null;
  districts: string[];
  zones: string[];
  created_at: Date;
};

export async function initDb(): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_hash text,
      phone_enc text,
      phone_last4 text,
      phone_masked text,
      phone text,
      govt_id text,
      role text NOT NULL CHECK (role IN ('CE','EE','CITIZEN')),
      districts text[] NOT NULL DEFAULT '{}',
      zones text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Migrate older dev DBs that only allowed CE/EE.
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('CE','EE','CITIZEN'));`);

  // Backwards compatible migration for older dev DBs.
  await pool.query(`ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;`);
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_enc text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_last4 text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_masked text;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS govt_id text;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_phone_hash_uniq ON users(phone_hash);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_hash text,
      phone_enc text,
      phone_last4 text,
      phone text,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS otp_sessions_phone_idx ON otp_sessions(phone);
  `);

  await pool.query(`ALTER TABLE otp_sessions ADD COLUMN IF NOT EXISTS phone_hash text;`);
  await pool.query(`ALTER TABLE otp_sessions ADD COLUMN IF NOT EXISTS phone_enc text;`);
  await pool.query(`ALTER TABLE otp_sessions ADD COLUMN IF NOT EXISTS phone_last4 text;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS otp_sessions_phone_hash_idx ON otp_sessions(phone_hash);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id text PRIMARY KEY,
      district text NOT NULL,
      zone text NOT NULL,
      status text NOT NULL,
      description text NOT NULL,
      lat double precision,
      lng double precision,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      fabric_txid text
    );
    CREATE INDEX IF NOT EXISTS complaints_district_zone_idx ON complaints(district, zone);
    CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints(status);
  `);

  // Region registry (powers mobile onboarding + offline package download).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS countries (
      code text PRIMARY KEY,
      name text NOT NULL,
      default_time_zone text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS states (
      country_code text NOT NULL REFERENCES countries(code) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      PRIMARY KEY(country_code, code)
    );

    CREATE TABLE IF NOT EXISTS districts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      country_code text NOT NULL REFERENCES countries(code) ON DELETE CASCADE,
      state_code text NOT NULL,
      code text NOT NULL,
      name text NOT NULL,
      top_left_lat double precision NOT NULL,
      top_left_lng double precision NOT NULL,
      bottom_right_lat double precision NOT NULL,
      bottom_right_lng double precision NOT NULL,
      min_zoom int NOT NULL DEFAULT 10,
      max_zoom int NOT NULL DEFAULT 16,
      tile_style_url text,
      UNIQUE(country_code, state_code, code)
    );
    CREATE INDEX IF NOT EXISTS districts_country_state_idx ON districts(country_code, state_code);

    CREATE TABLE IF NOT EXISTS roads_catalog (
      id text PRIMARY KEY,
      district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
      name text NOT NULL,
      road_type text NOT NULL,
      authority_id text NOT NULL,
      total_length_km double precision NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS roads_catalog_district_idx ON roads_catalog(district_id);
  `);

  // Optional GeoJSON geometry for roads (LineString/MultiLineString). Stored as jsonb to avoid PostGIS dependency.
  await pool.query(`ALTER TABLE roads_catalog ADD COLUMN IF NOT EXISTS geometry jsonb;`);

  // Link complaints to a road/authority when known.
  await pool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS road_id text;`);
  await pool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS authority_id text;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS complaints_road_id_idx ON complaints(road_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS complaints_authority_id_idx ON complaints(authority_id);`);

  // Public directory of authorities/departments responsible for roads (only public/office contacts).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS authority_directory (
      authority_id text PRIMARY KEY,
      name text NOT NULL,
      department text,
      public_phone text,
      public_email text,
      website text,
      address text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Analytics event stream (append-only) for dashboards, trends, and exports.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL,
      actor_user_id uuid,
      complaint_id text,
      contractor_id text,
      district text,
      zone text,
      lat double precision,
      lng double precision,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      properties jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS analytics_events_occurred_at_idx ON analytics_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS analytics_events_type_idx ON analytics_events(type);
    CREATE INDEX IF NOT EXISTS analytics_events_district_zone_idx ON analytics_events(district, zone);
    CREATE INDEX IF NOT EXISTS analytics_events_complaint_idx ON analytics_events(complaint_id);
    CREATE INDEX IF NOT EXISTS analytics_events_contractor_idx ON analytics_events(contractor_id);
  `);

  // Minimal contractor registry to support public performance scorecards.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contractors (
      id text PRIMARY KEY,
      name text NOT NULL,
      registration_number text,
      contact_phone_masked text,
      districts text[] NOT NULL DEFAULT '{}',
      zones text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS contractors_registration_uniq ON contractors(registration_number);
  `);

  // Assignment metadata for a road: contractor + engineer + active time window.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS road_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      road_id text NOT NULL REFERENCES roads_catalog(id) ON DELETE CASCADE,
      contractor_id text REFERENCES contractors(id) ON DELETE SET NULL,
      engineer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      starts_on date,
      ends_on date,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS road_assignments_road_idx ON road_assignments(road_id);
    CREATE INDEX IF NOT EXISTS road_assignments_contractor_idx ON road_assignments(contractor_id);
    CREATE INDEX IF NOT EXISTS road_assignments_engineer_idx ON road_assignments(engineer_user_id);
  `);

  // Complaint assignments create a link between complaints and contractors.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_assignments (
      complaint_id text PRIMARY KEY REFERENCES complaints(id) ON DELETE CASCADE,
      contractor_id text NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      expected_resolution_days int,
      assigned_by_user_id uuid,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      notes text
    );
    CREATE INDEX IF NOT EXISTS complaint_assignments_contractor_idx ON complaint_assignments(contractor_id);
  `);

  // RTI workflow (separate from complaint tracking)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rti_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      complaint_id text REFERENCES complaints(id) ON DELETE SET NULL,
      country_code text NOT NULL,
      authority_name text NOT NULL,
      subject text NOT NULL,
      request_text text NOT NULL,
      status text NOT NULL CHECK (status IN ('DRAFT','FILED','ACKNOWLEDGED','RESPONDED','APPEALED','CLOSED')),
      submitted_at timestamptz,
      response_due_at timestamptz,
      first_appeal_last_date timestamptz,
      second_appeal_last_date timestamptz,
      citizen_phone_hash text,
      tracking_token uuid NOT NULL,
      public_opt_in_at timestamptz,
      public_share_token uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rti_requests_tracking_token_uniq ON rti_requests(tracking_token);
    CREATE UNIQUE INDEX IF NOT EXISTS rti_requests_public_share_token_uniq ON rti_requests(public_share_token);
    CREATE INDEX IF NOT EXISTS rti_requests_country_status_idx ON rti_requests(country_code, status);
    CREATE INDEX IF NOT EXISTS rti_requests_complaint_idx ON rti_requests(complaint_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rti_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rti_id uuid NOT NULL REFERENCES rti_requests(id) ON DELETE CASCADE,
      type text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      properties jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS rti_events_rti_idx ON rti_events(rti_id);
    CREATE INDEX IF NOT EXISTS rti_events_occurred_at_idx ON rti_events(occurred_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rti_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rti_id uuid NOT NULL REFERENCES rti_requests(id) ON DELETE CASCADE,
      received_at timestamptz NOT NULL DEFAULT now(),
      file_path text NOT NULL,
      file_mime text,
      file_sha256 text NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS rti_responses_rti_idx ON rti_responses(rti_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rti_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rti_id uuid NOT NULL REFERENCES rti_requests(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('PHOTO','VIDEO','DOCUMENT')),
      file_path text NOT NULL,
      file_mime text,
      file_sha256 text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS rti_attachments_rti_idx ON rti_attachments(rti_id);
  `);

  // Complaint attachments (e.g. citizen-submitted photo evidence).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      complaint_id text NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('PHOTO','VIDEO','DOCUMENT')),
      file_path text NOT NULL,
      file_mime text,
      file_sha256 text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS complaint_attachments_complaint_idx ON complaint_attachments(complaint_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id uuid,
      actor_phone_hash text,
      actor_phone_masked text,
      actor_phone text,
      action text NOT NULL,
      target_type text NOT NULL,
      target_id text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      fabric_txid text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);
  `);

  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_phone_hash text;`);
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_phone_masked text;`);

  // Backfill legacy plaintext phones into hashed/encrypted columns (best-effort for dev DBs).
  await backfillLegacyPhones();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled_channels text[] NOT NULL DEFAULT ARRAY['IN_APP','FCM']::text[],
      dnd_enabled boolean NOT NULL DEFAULT true,
      dnd_start_minutes int NOT NULL DEFAULT 1320,
      dnd_end_minutes int NOT NULL DEFAULT 420,
      time_zone text NOT NULL DEFAULT 'Asia/Kolkata',
      authority_batching text NOT NULL DEFAULT 'IMMEDIATE' CHECK (authority_batching IN ('IMMEDIATE','DAILY_DIGEST')),
      digest_minutes int NOT NULL DEFAULT 540,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      district text,
      zone text,
      road_id text,
      critical boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_inbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS notification_inbox_user_created_idx ON notification_inbox(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS notification_inbox_user_notification_uniq ON notification_inbox(user_id, notification_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      channel text NOT NULL,
      status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')),
      scheduled_for timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz,
      error text,
      batch_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx ON notification_deliveries(status, scheduled_for);
  `);

  // Seed a CE user and a couple of sample complaints for first-run local dev.
  const seedPhone = normalizePhone('+910000000000');
  const seedHash = hashPhone(seedPhone);
  const seedMasked = maskPhone(seedPhone);
  const seedLast4 = phoneLast4(seedPhone);
  const seedEnc = (() => {
    try {
      return encryptPhone(seedPhone);
    } catch {
      return null;
    }
  })();
  await pool.query(
    `INSERT INTO users (phone_hash, phone_enc, phone_last4, phone_masked, role, districts, zones)
     VALUES ($1, $2, $3, $4, 'CE', ARRAY['ALL'], ARRAY['ALL'])
     ON CONFLICT (phone_hash) DO NOTHING;`,
    [seedHash, seedEnc, seedLast4, seedMasked]
  );

  const existingComplaints = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM complaints;`);
  if (Number(existingComplaints.rows[0]?.count ?? '0') === 0) {
    await pool.query(
      `INSERT INTO complaints (id, district, zone, status, description, lat, lng)
       VALUES
       ('RW-DEL-001', 'Delhi', 'Zone-1', 'PENDING', 'Pothole reported near Ring Road', 28.6139, 77.2090),
       ('RW-DEL-002', 'Delhi', 'Zone-2', 'PENDING', 'Broken drainage cover near metro station', 28.7041, 77.1025),
       ('RW-MH-001', 'Maharashtra', 'Zone-7', 'IN_PROGRESS', 'Road shoulder erosion on highway stretch', 19.0760, 72.8777);
      `
    );
  }

  // Seed baseline regions + demo roads (id values are stable so mobile can cache deterministically).
  await pool.query(
    `INSERT INTO countries (code, name, default_time_zone)
     VALUES ('IN', 'India', 'Asia/Kolkata')
     ON CONFLICT (code) DO NOTHING;`
  );
  await pool.query(
    `INSERT INTO states (country_code, code, name)
     VALUES
       ('IN', 'DL', 'Delhi'),
       ('IN', 'MH', 'Maharashtra')
     ON CONFLICT (country_code, code) DO NOTHING;`
  );
  await pool.query(
    `INSERT INTO districts (id, country_code, state_code, code, name, top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng, min_zoom, max_zoom, tile_style_url)
     VALUES
       ('b8b5c1d6-3f1e-4c73-9a09-2b2d74c18b6e', 'IN', 'DL', 'DL-ND', 'New Delhi', 28.889, 76.84, 28.40, 77.35, 10, 16, NULL),
       ('7a01f2c1-2e3b-4c19-9e15-0a1d0d66be33', 'IN', 'MH', 'MH-MUM', 'Mumbai', 19.33, 72.72, 18.89, 73.05, 10, 16, NULL)
     ON CONFLICT (country_code, state_code, code) DO NOTHING;`
  );
  await pool.query(
    `INSERT INTO roads_catalog (id, district_id, name, road_type, authority_id, total_length_km)
     VALUES
       ('RD-DL-001', 'b8b5c1d6-3f1e-4c73-9a09-2b2d74c18b6e', 'Ring Road', 'ARTERIAL', 'AUTH-DL', 48.0),
       ('RD-DL-002', 'b8b5c1d6-3f1e-4c73-9a09-2b2d74c18b6e', 'Outer Ring Road', 'ARTERIAL', 'AUTH-DL', 55.0),
       ('RD-MH-001', '7a01f2c1-2e3b-4c19-9e15-0a1d0d66be33', 'Western Express Highway', 'HIGHWAY', 'AUTH-MH', 25.0),
       ('RD-MH-002', '7a01f2c1-2e3b-4c19-9e15-0a1d0d66be33', 'Eastern Express Highway', 'HIGHWAY', 'AUTH-MH', 22.0)
     ON CONFLICT (id) DO NOTHING;`
  );

  // Seed a couple of sample contractors for first-run local dev.
  const existingContractors = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM contractors;`);
  if (Number(existingContractors.rows[0]?.count ?? '0') === 0) {
    await pool.query(
      `INSERT INTO contractors (id, name, registration_number, districts, zones)
       VALUES
       ('CTR-DEL-001', 'Delhi RoadWorks Co.', 'REG-DEL-001', ARRAY['Delhi'], ARRAY['Zone-1','Zone-2']),
       ('CTR-MH-001', 'Maharashtra Infra Repairs', 'REG-MH-001', ARRAY['Maharashtra'], ARRAY['Zone-7']);`
    );
  }
}

export async function createContractor(input: {
  companyName: string;
  registrationNumber: string;
  contactPhoneMasked?: string | null;
  districts?: string[];
  zones?: string[];
}): Promise<{ id: string; companyName: string; registrationNumber: string; contactPhoneMasked: string | null; districts: string[]; zones: string[] }> {
  const districts = input.districts ?? [];
  const zones = input.zones ?? [];

  const r = await pool.query<{
    id: string;
    name: string;
    registration_number: string | null;
    contact_phone_masked: string | null;
    districts: string[];
    zones: string[];
  }>(
    `INSERT INTO contractors (id, name, registration_number, contact_phone_masked, districts, zones)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
     ON CONFLICT (registration_number)
     DO UPDATE SET
       name = EXCLUDED.name,
       contact_phone_masked = COALESCE(EXCLUDED.contact_phone_masked, contractors.contact_phone_masked),
       districts = CASE WHEN array_length(EXCLUDED.districts, 1) IS NULL THEN contractors.districts ELSE EXCLUDED.districts END,
       zones = CASE WHEN array_length(EXCLUDED.zones, 1) IS NULL THEN contractors.zones ELSE EXCLUDED.zones END
     RETURNING id, name, registration_number, contact_phone_masked, districts, zones;`,
    [input.companyName, input.registrationNumber, input.contactPhoneMasked ?? null, districts, zones]
  );

  const row = r.rows[0]!;
  return {
    id: row.id,
    companyName: row.name,
    registrationNumber: row.registration_number ?? input.registrationNumber,
    contactPhoneMasked: row.contact_phone_masked,
    districts: row.districts,
    zones: row.zones
  };
}

async function backfillLegacyPhones(): Promise<void> {
  // Users
  const legacyUsers = await pool.query<{ id: string; phone: string | null; phone_hash: string | null }>(
    `SELECT id, phone, phone_hash FROM users WHERE phone_hash IS NULL AND phone IS NOT NULL LIMIT 5000;`
  );

  for (const u of legacyUsers.rows) {
    const p = u.phone ? normalizePhone(u.phone) : '';
    if (!p) continue;
    const h = hashPhone(p);
    const masked = maskPhone(p);
    const last4 = phoneLast4(p);
    const enc = (() => {
      try {
        return encryptPhone(p);
      } catch {
        return null;
      }
    })();

    try {
      await pool.query(
        `UPDATE users
         SET phone_hash = $2,
             phone_enc = COALESCE(phone_enc, $3),
             phone_last4 = COALESCE(phone_last4, $4),
             phone_masked = COALESCE(phone_masked, $5)
         WHERE id = $1 AND phone_hash IS NULL;`,
        [u.id, h, enc, last4, masked]
      );
    } catch {
      // If unique constraint conflicts, skip this legacy row.
    }
  }

  // OTP sessions
  const legacyOtps = await pool.query<{ id: string; phone: string | null; phone_hash: string | null }>(
    `SELECT id, phone, phone_hash FROM otp_sessions WHERE phone_hash IS NULL AND phone IS NOT NULL LIMIT 5000;`
  );

  for (const s of legacyOtps.rows) {
    const p = s.phone ? normalizePhone(s.phone) : '';
    if (!p) continue;
    const h = hashPhone(p);
    const masked = maskPhone(p);
    const last4 = phoneLast4(p);
    const enc = (() => {
      try {
        return encryptPhone(p);
      } catch {
        return null;
      }
    })();

    await pool.query(
      `UPDATE otp_sessions
       SET phone_hash = $2,
           phone_enc = COALESCE(phone_enc, $3),
           phone_last4 = COALESCE(phone_last4, $4),
           phone = COALESCE(phone, $5)
       WHERE id = $1 AND phone_hash IS NULL;`,
      [s.id, h, enc, last4, masked]
    );
  }
}

export async function getUserByPhone(phone: string): Promise<UserRow | null> {
  const normalized = normalizePhone(phone);
  const h = hashPhone(normalized);

  const r = await pool.query<any>(
    `
     SELECT
       id,
       COALESCE(phone_masked, phone, '') as phone,
       phone_hash,
       phone_enc,
       phone_last4,
       govt_id,
       role,
       districts,
       zones,
       created_at
     FROM users
     WHERE phone_hash = $1 OR phone = $2
     LIMIT 1;
     `,
    [h, normalized]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    phoneHash: row.phone_hash ?? null,
    phoneEnc: row.phone_enc ?? null,
    phoneLast4: row.phone_last4 ?? null,
    govtId: row.govt_id ?? null,
    role: row.role,
    districts: row.districts,
    zones: row.zones,
    created_at: row.created_at
  };
}

export async function upsertUser(params: {
  phone: string;
  role: Role;
  districts: string[];
  zones: string[];
  govtId?: string | null;
}): Promise<UserRow> {
  const normalized = normalizePhone(params.phone);
  const phoneHash = hashPhone(normalized);
  const phoneMasked = maskPhone(normalized);
  const last4 = phoneLast4(normalized);
  const enc = (() => {
    try {
      return encryptPhone(normalized);
    } catch {
      return null;
    }
  })();

  const r = await pool.query<any>(
    `
     INSERT INTO users (phone_hash, phone_enc, phone_last4, phone_masked, govt_id, role, districts, zones)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (phone_hash)
     DO UPDATE SET
       phone_enc = COALESCE(EXCLUDED.phone_enc, users.phone_enc),
       phone_last4 = COALESCE(EXCLUDED.phone_last4, users.phone_last4),
       phone_masked = COALESCE(EXCLUDED.phone_masked, users.phone_masked),
       govt_id = COALESCE(EXCLUDED.govt_id, users.govt_id),
       role = EXCLUDED.role,
       districts = EXCLUDED.districts,
       zones = EXCLUDED.zones
     RETURNING id,
       COALESCE(phone_masked, phone, '') as phone,
       phone_hash,
       phone_enc,
       phone_last4,
       govt_id,
       role,
       districts,
       zones,
       created_at;
     `,
    [phoneHash, enc, last4, phoneMasked, params.govtId ?? null, params.role, params.districts, params.zones]
  );

  const row = r.rows[0]!;
  return {
    id: row.id,
    phone: row.phone,
    phoneHash: row.phone_hash ?? null,
    phoneEnc: row.phone_enc ?? null,
    phoneLast4: row.phone_last4 ?? null,
    govtId: row.govt_id ?? null,
    role: row.role,
    districts: row.districts,
    zones: row.zones,
    created_at: row.created_at
  };
}

export async function listUsers(params?: { roles?: Role[]; limit?: number }): Promise<UserRow[]> {
  const limit = Math.min(5000, Math.max(1, Math.floor(params?.limit ?? 500)));
  const roles = params?.roles?.length ? params.roles : undefined;

  const values: any[] = [];
  const where: string[] = [];
  if (roles) {
    values.push(roles);
    where.push(`role = ANY($${values.length}::text[])`);
  }
  values.push(limit);

  const r = await pool.query<any>(
    `SELECT
       id,
       COALESCE(phone_masked, phone, '') as phone,
       phone_hash,
       phone_enc,
       phone_last4,
       govt_id,
       role,
       districts,
       zones,
       created_at
     FROM users
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${values.length};`,
    values
  );

  return (r.rows as any[]).map((row) => ({
    id: row.id,
    phone: row.phone,
    phoneHash: row.phone_hash ?? null,
    phoneEnc: row.phone_enc ?? null,
    phoneLast4: row.phone_last4 ?? null,
    govtId: row.govt_id ?? null,
    role: row.role,
    districts: row.districts,
    zones: row.zones,
    created_at: row.created_at
  }));
}

// ---------------------------------------------------------------------------
// Public onboarding data (mobile-host)
//
// This is intentionally minimal and non-PII. The primary goal is to provide a
// stable API surface for clients and local dev.
// ---------------------------------------------------------------------------

export type Country = { code: string; name: string; timeZone: string };
export type State = { code: string; name: string };
export type District = { id: string; code: string; name: string };
export type OfflineManifest = {
  districtId: string;
  bbox: { topLeft: { lat: number; lng: number }; bottomRight: { lat: number; lng: number } };
  zoom: { min: number; max: number };
  tileStyleUrl: string | null;
};
export type RoadCatalogItem = {
  id: string;
  name: string;
  roadType: string;
  authorityId: string;
  totalLengthKm: number;
};

type CountryRow = { code: string; name: string; default_time_zone: string };
type StateRow = { country_code: string; code: string; name: string };
type DistrictRow = {
  id: string;
  country_code: string;
  state_code: string;
  code: string;
  name: string;
  top_left_lat: number;
  top_left_lng: number;
  bottom_right_lat: number;
  bottom_right_lng: number;
  min_zoom: number;
  max_zoom: number;
  tile_style_url: string | null;
};

export async function listCountries(): Promise<Country[]> {
  const r = await pool.query<CountryRow>(`SELECT code, name, default_time_zone FROM countries ORDER BY name ASC;`);
  return r.rows.map((c) => ({ code: c.code, name: c.name, timeZone: c.default_time_zone }));
}

export async function listStates(countryCode: string): Promise<State[]> {
  const r = await pool.query<StateRow>(
    `SELECT country_code, code, name FROM states WHERE country_code = $1 ORDER BY name ASC;`,
    [countryCode]
  );
  return r.rows.map((s) => ({ code: s.code, name: s.name }));
}

export async function listDistricts(countryCode: string, stateCode: string): Promise<District[]> {
  const r = await pool.query<DistrictRow>(
    `SELECT * FROM districts WHERE country_code = $1 AND state_code = $2 ORDER BY name ASC;`,
    [countryCode, stateCode]
  );
  return r.rows.map((d) => ({ id: d.id, code: d.code, name: d.name }));
}

export async function getDistrictOfflineManifest(districtId: string): Promise<OfflineManifest | null> {
  const r = await pool.query<DistrictRow>(`SELECT * FROM districts WHERE id = $1 LIMIT 1;`, [districtId]);
  const d = r.rows[0];
  if (!d) return null;
  return {
    districtId: d.id,
    bbox: {
      topLeft: { lat: d.top_left_lat, lng: d.top_left_lng },
      bottomRight: { lat: d.bottom_right_lat, lng: d.bottom_right_lng }
    },
    zoom: { min: d.min_zoom, max: d.max_zoom },
    tileStyleUrl: d.tile_style_url
  };
}

export async function listRoadsForDistrict(districtId: string): Promise<RoadCatalogItem[]> {
  const r = await pool.query<{
    id: string;
    name: string;
    road_type: string;
    authority_id: string;
    total_length_km: number;
  }>(
    `SELECT id, name, road_type, authority_id, total_length_km FROM roads_catalog WHERE district_id = $1 ORDER BY id ASC;`,
    [districtId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    roadType: row.road_type,
    authorityId: row.authority_id,
    totalLengthKm: row.total_length_km
  }));
}

export async function upsertCountry(input: {
  code: string;
  name: string;
  defaultTimeZone: string;
}): Promise<Country> {
  const r = await pool.query<CountryRow>(
    `INSERT INTO countries (code, name, default_time_zone)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, default_time_zone = EXCLUDED.default_time_zone
     RETURNING code, name, default_time_zone;`,
    [input.code.toUpperCase(), input.name, input.defaultTimeZone]
  );
  const row = r.rows[0]!;
  return { code: row.code, name: row.name, timeZone: row.default_time_zone };
}

export async function upsertState(input: { countryCode: string; code: string; name: string }): Promise<State & { countryCode: string }> {
  const r = await pool.query<StateRow>(
    `INSERT INTO states (country_code, code, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (country_code, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING country_code, code, name;`,
    [input.countryCode.toUpperCase(), input.code.toUpperCase(), input.name]
  );
  const row = r.rows[0]!;
  return { countryCode: row.country_code, code: row.code, name: row.name };
}

export async function upsertDistrict(input: {
  countryCode: string;
  stateCode: string;
  code: string;
  name: string;
  bbox: { topLeft: { lat: number; lng: number }; bottomRight: { lat: number; lng: number } };
  zoom?: { min: number; max: number };
  tileStyleUrl?: string | null;
}): Promise<District> {
  const zoomMin = input.zoom?.min ?? 10;
  const zoomMax = input.zoom?.max ?? 16;

  const r = await pool.query<{ id: string; code: string; name: string }>(
    `INSERT INTO districts (
       country_code, state_code, code, name,
       top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng,
       min_zoom, max_zoom, tile_style_url
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (country_code, state_code, code)
     DO UPDATE SET
       name = EXCLUDED.name,
       top_left_lat = EXCLUDED.top_left_lat,
       top_left_lng = EXCLUDED.top_left_lng,
       bottom_right_lat = EXCLUDED.bottom_right_lat,
       bottom_right_lng = EXCLUDED.bottom_right_lng,
       min_zoom = EXCLUDED.min_zoom,
       max_zoom = EXCLUDED.max_zoom,
       tile_style_url = EXCLUDED.tile_style_url
     RETURNING id, code, name;`,
    [
      input.countryCode.toUpperCase(),
      input.stateCode.toUpperCase(),
      input.code.toUpperCase(),
      input.name,
      input.bbox.topLeft.lat,
      input.bbox.topLeft.lng,
      input.bbox.bottomRight.lat,
      input.bbox.bottomRight.lng,
      zoomMin,
      zoomMax,
      input.tileStyleUrl ?? null
    ]
  );
  return r.rows[0]!;
}

export async function bulkUpsertRoads(input: {
  districtId: string;
  roads: Array<{
    id: string;
    name: string;
    roadType: string;
    authorityId: string;
    totalLengthKm?: number;
    geometry?: any;
  }>;
}): Promise<{ insertedOrUpdated: number }> {
  if (input.roads.length === 0) return { insertedOrUpdated: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const road of input.roads) {
      await client.query(
        `INSERT INTO roads_catalog (id, district_id, name, road_type, authority_id, total_length_km, geometry)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id)
         DO UPDATE SET
           district_id = EXCLUDED.district_id,
           name = EXCLUDED.name,
           road_type = EXCLUDED.road_type,
           authority_id = EXCLUDED.authority_id,
           total_length_km = EXCLUDED.total_length_km,
           geometry = COALESCE(EXCLUDED.geometry, roads_catalog.geometry);`,
        [
          road.id,
          input.districtId,
          road.name,
          road.roadType,
          road.authorityId,
          road.totalLengthKm ?? 0,
          road.geometry ? JSON.stringify(road.geometry) : null
        ]
      );
      count++;
    }
    await client.query('COMMIT');
    return { insertedOrUpdated: count };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function upsertAuthorityDirectory(input: {
  authorityId: string;
  name: string;
  department?: string | null;
  publicPhone?: string | null;
  publicEmail?: string | null;
  website?: string | null;
  address?: string | null;
}): Promise<{
  authorityId: string;
  name: string;
  department: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  website: string | null;
  address: string | null;
  updatedAt: string;
}> {
  const r = await pool.query(
    `INSERT INTO authority_directory (authority_id, name, department, public_phone, public_email, website, address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (authority_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       department = EXCLUDED.department,
       public_phone = EXCLUDED.public_phone,
       public_email = EXCLUDED.public_email,
       website = EXCLUDED.website,
       address = EXCLUDED.address,
       updated_at = now()
     RETURNING authority_id, name, department, public_phone, public_email, website, address, updated_at;`,
    [
      input.authorityId,
      input.name,
      input.department ?? null,
      input.publicPhone ?? null,
      input.publicEmail ?? null,
      input.website ?? null,
      input.address ?? null
    ]
  );

  const row = r.rows[0]!;
  return {
    authorityId: row.authority_id,
    name: row.name,
    department: row.department,
    publicPhone: row.public_phone,
    publicEmail: row.public_email,
    website: row.website,
    address: row.address,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function createRoadAssignment(input: {
  roadId: string;
  contractorId?: string | null;
  engineerUserId?: string | null;
  startsOn?: string | null; // YYYY-MM-DD
  endsOn?: string | null; // YYYY-MM-DD
}): Promise<{
  id: string;
  roadId: string;
  contractorId: string | null;
  engineerUserId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
}> {
  const r = await pool.query(
    `INSERT INTO road_assignments (road_id, contractor_id, engineer_user_id, starts_on, ends_on)
     VALUES ($1, $2, $3::uuid, $4::date, $5::date)
     RETURNING id, road_id, contractor_id, engineer_user_id, starts_on, ends_on, created_at;`,
    [
      input.roadId,
      input.contractorId ?? null,
      input.engineerUserId ?? null,
      input.startsOn ?? null,
      input.endsOn ?? null
    ]
  );

  const row = r.rows[0]!;
  return {
    id: row.id,
    roadId: row.road_id,
    contractorId: row.contractor_id,
    engineerUserId: row.engineer_user_id,
    startsOn: row.starts_on ? new Date(row.starts_on).toISOString().slice(0, 10) : null,
    endsOn: row.ends_on ? new Date(row.ends_on).toISOString().slice(0, 10) : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}
