import { randomUUID } from 'crypto';
import { pool } from './postgres.js';
import { encryptPhone, hashPhone, maskPhone, normalizePhone, phoneLast4 } from './security/phone.js';

export type Role = 'CE' | 'EE' | 'CONTRACTOR' | 'CITIZEN';

export type UserRow = {
  id: string;
  phone: string; // masked
  phoneHash: string | null;
  phoneEnc: string | null;
  phoneLast4: string | null;
  username: string | null;
  clerkUserId: string | null;
  email: string | null;
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
  // PostgreSQL migrations are handled by migration scripts.
  // Verify connection to database.
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    console.log('PostgreSQL connected and ready');
  } finally {
    client.release();
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
  const id = randomUUID();

  await pool.query(
    `INSERT INTO contractors (id, name, registration_number, contact_phone_masked, districts, zones, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.companyName, input.registrationNumber, input.contactPhoneMasked ?? null, districts, zones, new Date()]
  );

  return {
    id,
    companyName: input.companyName,
    registrationNumber: input.registrationNumber,
    contactPhoneMasked: input.contactPhoneMasked ?? null,
    districts,
    zones
  };
}

export async function getUserByPhone(phone: string): Promise<UserRow | null> {
  const normalized = normalizePhone(phone);
  const h = hashPhone(normalized);

  const result = await pool.query(
    `SELECT id, phone, phone_hash, phone_enc, phone_last4, username, clerk_user_id, email, govt_id, role, districts, zones, created_at
     FROM users
     WHERE phone_hash = $1`,
    [h]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    phone: row.phone ?? '',
    phoneHash: row.phone_hash ?? null,
    phoneEnc: row.phone_enc ?? null,
    phoneLast4: row.phone_last4 ?? null,
    username: row.username ?? null,
    clerkUserId: row.clerk_user_id ?? null,
    email: row.email ?? null,
    govtId: row.govt_id ?? null,
    role: (row.role as Role) ?? 'CITIZEN',
    districts: row.districts ?? [],
    zones: row.zones ?? [],
    created_at: row.created_at
  };
}

export async function getUserByIdentifier(identifier: string): Promise<UserRow | null> {
  const normalized = identifier.trim();
  const normalizedPhone = normalized.startsWith('+') || /^\d+$/.test(normalized) ? normalizePhone(normalized) : null;

  if (normalizedPhone) {
    return getUserByPhone(normalizedPhone);
  }

  // Try username or email lookup
  const lowerIdent = normalized.toLowerCase();
  const result = await pool.query(
    `SELECT id, phone, phone_hash, phone_enc, phone_last4, username, clerk_user_id, email, govt_id, role, districts, zones, created_at
     FROM users
     WHERE LOWER(username) = $1 OR LOWER(email) = $1`,
    [lowerIdent]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    phone: row.phone ?? '',
    phoneHash: row.phone_hash ?? null,
    phoneEnc: row.phone_enc ?? null,
    phoneLast4: row.phone_last4 ?? null,
    username: row.username ?? null,
    clerkUserId: row.clerk_user_id ?? null,
    email: row.email ?? null,
    govtId: row.govt_id ?? null,
    role: (row.role as Role) ?? 'CITIZEN',
    districts: row.districts ?? [],
    zones: row.zones ?? [],
    created_at: row.created_at
  };
}

export async function upsertUser(params: {
  phone: string;
  role: Role;
  districts: string[];
  zones: string[];
  govtId?: string | null;
  username?: string | null;
  clerkUserId?: string | null;
  email?: string | null;
}): Promise<UserRow> {
  const normalized = normalizePhone(params.phone);
  const phoneHash = hashPhone(normalized);
  const phoneMasked = maskPhone(normalized);
  const last4 = phoneLast4(normalized);
  const username = params.username ? params.username.trim().toLowerCase() : null;
  const clerkUserId = params.clerkUserId ? params.clerkUserId.trim() : null;
  const email = params.email ? params.email.trim().toLowerCase() : null;
  const enc = (() => {
    try {
      return encryptPhone(normalized);
    } catch {
      return null;
    }
  })();

  const now = new Date();

  await pool.query(
    `INSERT INTO users (id, phone, phone_hash, phone_enc, phone_last4, username, clerk_user_id, email, govt_id, role, districts, zones, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (phone_hash) DO UPDATE SET
       phone = $2,
       phone_enc = $4,
       phone_last4 = $5,
       username = $6,
       clerk_user_id = $7,
       email = $8,
       govt_id = $9,
       role = $10,
       districts = $11,
       zones = $12,
       updated_at = $14`,
    [
      randomUUID(),
      normalized,
      phoneHash,
      enc,
      last4,
      username,
      clerkUserId,
      email,
      params.govtId ?? null,
      params.role,
      params.districts,
      params.zones,
      now,
      now
    ]
  );

  return {
    id: randomUUID(),
    phone: phoneMasked,
    phoneHash,
    phoneEnc: enc,
    phoneLast4: last4,
    username: username ?? null,
    clerkUserId: clerkUserId ?? null,
    email: email ?? null,
    govtId: params.govtId ?? null,
    role: params.role,
    districts: params.districts,
    zones: params.zones,
    created_at: now
  };
}

export async function listUsers(params?: { roles?: Role[]; limit?: number }): Promise<UserRow[]> {
  const limit = Math.min(5000, Math.max(1, Math.floor(params?.limit ?? 500)));

  let query = 'SELECT id, phone, phone_hash, phone_enc, phone_last4, username, clerk_user_id, email, govt_id, role, districts, zones, created_at FROM users';
  const queryParams: any[] = [];

  if (params?.roles && params.roles.length > 0) {
    query += ' WHERE role = ANY($1)';
    queryParams.push(params.roles);
  }

  query += ` LIMIT $${queryParams.length + 1}`;
  queryParams.push(limit);

  const result = await pool.query(query, queryParams);

  return result.rows.map((row: any) => ({
    id: row.id,
    phone: row.phone ?? '',
    phoneHash: row.phone_hash ?? null,
    phoneEnc: row.phone_enc ?? null,
    phoneLast4: row.phone_last4 ?? null,
    username: row.username ?? null,
    clerkUserId: row.clerk_user_id ?? null,
    email: row.email ?? null,
    govtId: row.govt_id ?? null,
    role: (row.role as Role) ?? 'CITIZEN',
    districts: row.districts ?? [],
    zones: row.zones ?? [],
    created_at: row.created_at
  })) as UserRow[];
}

// ---------------------------------------------------------------------------
// Public onboarding data (mobile-host)
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

export async function listCountries(): Promise<Country[]> {
  const result = await pool.query(
    `SELECT code, name, default_time_zone FROM countries ORDER BY name ASC`
  );

  return result.rows.map((c: any) => ({
    code: c.code,
    name: c.name,
    timeZone: c.default_time_zone
  }));
}

export async function listStates(countryCode: string): Promise<State[]> {
  const result = await pool.query(
    `SELECT code, name FROM states WHERE country_code = $1 ORDER BY name ASC`,
    [countryCode]
  );

  return result.rows.map((s: any) => ({
    code: s.code,
    name: s.name
  }));
}

export async function listDistricts(countryCode: string, stateCode: string): Promise<District[]> {
  const result = await pool.query(
    `SELECT id, code, name FROM districts WHERE country_code = $1 AND state_code = $2`,
    [countryCode, stateCode]
  );

  return result.rows.map((d: any) => ({
    id: d.id,
    code: d.code,
    name: d.name
  }));
}

export async function getDistrictOfflineManifest(districtId: string): Promise<OfflineManifest | null> {
  const result = await pool.query(
    `SELECT id, top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng, min_zoom, max_zoom, tile_style_url
     FROM districts WHERE id = $1`,
    [districtId]
  );

  if (result.rows.length === 0) return null;

  const d = result.rows[0];
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
  const result = await pool.query(
    `SELECT id, name, road_type, authority_id, total_length_km
     FROM roads_catalog WHERE district_id = $1`,
    [districtId]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    roadType: row.road_type ?? '',
    authorityId: row.authority_id ?? '',
    totalLengthKm: row.total_length_km ?? 0
  })) as RoadCatalogItem[];
}

export async function upsertCountry(input: {
  code: string;
  name: string;
  defaultTimeZone: string;
}): Promise<Country> {
  await pool.query(
    `INSERT INTO countries (code, name, default_time_zone) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = $2, default_time_zone = $3`,
    [input.code.toUpperCase(), input.name, input.defaultTimeZone]
  );

  return {
    code: input.code.toUpperCase(),
    name: input.name,
    timeZone: input.defaultTimeZone
  };
}

export async function upsertState(input: {
  countryCode: string;
  code: string;
  name: string;
}): Promise<State & { countryCode: string }> {
  await pool.query(
    `INSERT INTO states (country_code, code, name) VALUES ($1, $2, $3)
     ON CONFLICT (country_code, code) DO UPDATE SET name = $3`,
    [input.countryCode.toUpperCase(), input.code.toUpperCase(), input.name]
  );

  return {
    countryCode: input.countryCode.toUpperCase(),
    code: input.code.toUpperCase(),
    name: input.name
  };
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
  const id = randomUUID();

  await pool.query(
    `INSERT INTO districts (id, country_code, state_code, code, name, top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng, min_zoom, max_zoom, tile_style_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       code = $4, name = $5, top_left_lat = $6, top_left_lng = $7,
       bottom_right_lat = $8, bottom_right_lng = $9, min_zoom = $10, max_zoom = $11, tile_style_url = $12`,
    [
      id,
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

  return {
    id,
    code: input.code.toUpperCase(),
    name: input.name
  };
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

    for (const road of input.roads) {
      await client.query(
        `INSERT INTO roads_catalog (id, name, district_id, road_type, authority_id, total_length_km, geometry)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, road_type = $4, authority_id = $5, total_length_km = $6, geometry = $7`,
        [
          road.id,
          road.name,
          input.districtId,
          road.roadType,
          road.authorityId,
          road.totalLengthKm ?? 0,
          road.geometry ?? null
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { insertedOrUpdated: input.roads.length };
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
  const updatedAt = new Date();

  await pool.query(
    `INSERT INTO authority_directory (authority_id, name, department, public_phone, public_email, website, address, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (authority_id) DO UPDATE SET
       name = $2, department = $3, public_phone = $4, public_email = $5, website = $6, address = $7, updated_at = $8`,
    [
      input.authorityId,
      input.name,
      input.department ?? null,
      input.publicPhone ?? null,
      input.publicEmail ?? null,
      input.website ?? null,
      input.address ?? null,
      updatedAt
    ]
  );

  return {
    authorityId: input.authorityId,
    name: input.name,
    department: input.department ?? null,
    publicPhone: input.publicPhone ?? null,
    publicEmail: input.publicEmail ?? null,
    website: input.website ?? null,
    address: input.address ?? null,
    updatedAt: updatedAt.toISOString()
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
  const id = randomUUID();
  const now = new Date();

  await pool.query(
    `INSERT INTO road_assignments (id, road_id, contractor_id, engineer_user_id, starts_on, ends_on, assigned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.roadId,
      input.contractorId ?? null,
      input.engineerUserId ?? null,
      input.startsOn ?? null,
      input.endsOn ?? null,
      now
    ]
  );

  return {
    id,
    roadId: input.roadId,
    contractorId: input.contractorId ?? null,
    engineerUserId: input.engineerUserId ?? null,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
    createdAt: now.toISOString()
  };
}