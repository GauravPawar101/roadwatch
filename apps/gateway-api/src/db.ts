import { randomUUID } from 'crypto';
import { client, connect, execute } from './cassandra.js';
import { encryptPhone, hashPhone, maskPhone, normalizePhone, phoneLast4 } from './security/phone.js';

// Compatibility shim: provide a `pool.query(sql, params)` wrapper used by other modules.
export const pool: {
  query: <T = any>(sql: string, params?: any[]) => Promise<any>;
  connect: () => Promise<{ query: <T = any>(sql: string, params?: any[]) => Promise<any>; release: () => void }>;
} = {
  async query<T = any>(sql: string, params?: any[]) {
    const raw = (sql || '');
    const s = raw.trim().toUpperCase();
    // Common health check pattern used in services
    if (s === 'SELECT 1' || s.startsWith('SELECT 1;')) {
      const r = await execute('SELECT release_version FROM system.local', [], { prepare: true });
      return { rows: [{ release_version: r.rows[0]?.release_version ?? null }] } as any;
    }
    if (s.startsWith('SELECT NOW()') || s.startsWith('SELECT NOW')) {
      const r = await execute('SELECT now() FROM system.local', [], { prepare: true });
      return { rows: [{ now: r.rows[0]?.now ?? new Date() }] } as any;
    }

    // Attempt a best-effort translation of Postgres parameterized SQL to simple CQL
    try {
      let cql = raw;
      const newParams: any[] = Array.isArray(params) ? params.slice() : [];

      // Remove type casts like ::uuid, ::jsonb
      cql = cql.replace(/::[a-zA-Z0-9_]+/g, '');

      // Replace Postgres $1, $2 placeholders with CQL ?
      cql = cql.replace(/\$\d+/g, '?');

      // Strip RETURNING clauses (Cassandra does not support)
      cql = cql.replace(/\bRETURNING\b[\s\S]*$/i, '');

      // Remove ON CONFLICT ... DO UPDATE (Cassandra INSERT will upsert)
      cql = cql.replace(/ON\s+CONFLICT[\s\S]*?DO\s+UPDATE[\s\S]*/i, '');

      // Replace now() usages with parameterized Date values
      if (/now\s*\(\s*\)/i.test(cql) || /CURRENT_TIMESTAMP/i.test(cql)) {
        cql = cql.replace(/now\s*\(\s*\)/ig, '?');
        cql = cql.replace(/CURRENT_TIMESTAMP/ig, '?');
        newParams.push(new Date());
      }

      // Basic cast removals for json operations like '::jsonb' done above. Also remove '::text' etc.

      const res = await execute(cql, newParams, { prepare: true });
      // Normalize to match pg Pool.query shape
      return { rows: res.rows } as any;
    } catch (e) {
      throw new Error(`Unmapped or failed SQL -> CQL translation for query: ${sql}\nError: ${String(e)}`);
    }
  }
  ,
  async connect() {
    // Provide a minimal client wrapper so code that calls `pool.connect()` still typechecks and runs.
    return {
      query: async <T = any>(sql: string, params?: any[]) => {
        return await (pool.query as any)(sql, params) as any;
      },
      release: () => {}
    };
  }
};

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
  // DDL and seeding moved to docker/cassandra/init.cql + seed scripts.
  // Just ensure Cassandra client is connected for runtime use.
  await connect();
  return;
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
  const metadata = JSON.stringify({ registrationNumber: input.registrationNumber, contactPhoneMasked: input.contactPhoneMasked ?? null, districts, zones });
  await execute(
    `INSERT INTO contractors (id, name, metadata, created_at) VALUES (?, ?, ?, ?)`,
    [id, input.companyName, metadata, new Date()],
    { prepare: true }
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

async function backfillLegacyPhones(): Promise<void> {
  // Legacy backfill is not implemented for Cassandra migration.
  // Use `scripts/migrate-postgres-to-cassandra` to perform data migration.
  return;
}

export async function getUserByPhone(phone: string): Promise<UserRow | null> {
  const normalized = normalizePhone(phone);
  const h = hashPhone(normalized);
  // Lookup via users_by_phonehash table
  const map = await execute('SELECT user_id FROM users_by_phonehash WHERE phone_hash = ?', [h], { prepare: true });
  const userId = map.rows[0]?.user_id;
  if (!userId) return null;
  const r2 = await execute('SELECT id, phone, phone_hash, identifier, metadata, created_at, updated_at FROM users WHERE id = ?', [userId], { prepare: true });
  const row = r2.rows[0];
  if (!row) return null;
  const meta = row.metadata ? JSON.parse(row.metadata) : {};
  return {
    id: row.id,
    phone: row.phone ?? meta.phone_masked ?? '',
    phoneHash: row.phone_hash ?? null,
    phoneEnc: meta.phone_enc ?? null,
    phoneLast4: meta.phone_last4 ?? null,
    username: meta.username ?? null,
    clerkUserId: meta.clerk_user_id ?? null,
    email: meta.email ?? null,
    govtId: meta.govt_id ?? null,
    role: (meta.role as Role) ?? 'CITIZEN',
    districts: meta.districts ?? [],
    zones: meta.zones ?? [],
    created_at: row.created_at
  };
}

export async function getUserByIdentifier(identifier: string): Promise<UserRow | null> {
  const normalized = identifier.trim();
  const normalizedPhone = normalized.startsWith('+') || /^\d+$/.test(normalized) ? normalizePhone(normalized) : null;
  const phoneHash = normalizedPhone ? hashPhone(normalizedPhone) : null;
  const loginName = normalized.toLowerCase();
  if (phoneHash) return getUserByPhone(normalizedPhone as string);
  // Non-phone identifier lookups require additional denormalized tables (username/email). Not implemented yet.
  return null;
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

  // Upsert user into `users` table storing most attributes in `metadata` JSON.
  const existing = await execute('SELECT user_id FROM users_by_phonehash WHERE phone_hash = ?', [phoneHash], { prepare: true });
  let id = existing.rows[0]?.user_id;
  const metadata = {
    phone_enc: enc,
    phone_last4: last4,
    phone_masked: phoneMasked,
    username,
    clerk_user_id: clerkUserId,
    email,
    govt_id: params.govtId ?? null,
    role: params.role,
    districts: params.districts,
    zones: params.zones
  };
  if (!id) {
    id = randomUUID();
    await execute('INSERT INTO users (id, phone, phone_hash, identifier, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, normalized, phoneHash, null, JSON.stringify(metadata), new Date(), new Date()], { prepare: true });
    await execute('INSERT INTO users_by_phonehash (phone_hash, user_id) VALUES (?, ?)', [phoneHash, id], { prepare: true });
  } else {
    // Update metadata for existing user (replace whole metadata blob)
    await execute('UPDATE users SET phone = ?, metadata = ?, updated_at = ? WHERE id = ?', [normalized, JSON.stringify(metadata), new Date(), id], { prepare: true });
  }

  return {
    id,
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
    created_at: new Date()
  };
}

export async function listUsers(params?: { roles?: Role[]; limit?: number }): Promise<UserRow[]> {
  const limit = Math.min(5000, Math.max(1, Math.floor(params?.limit ?? 500)));
  // Simple listing via scanning `users` (may be inefficient for large datasets).
  const r = await execute(`SELECT id, phone, phone_hash, metadata, created_at FROM users LIMIT ?`, [limit], { prepare: true });
  return r.rows.map((row: any) => {
    const meta = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      id: row.id,
      phone: row.phone ?? meta.phone_masked ?? '',
      phoneHash: row.phone_hash ?? null,
      phoneEnc: meta.phone_enc ?? null,
      phoneLast4: meta.phone_last4 ?? null,
      username: meta.username ?? null,
      clerkUserId: meta.clerk_user_id ?? null,
      email: meta.email ?? null,
      govtId: meta.govt_id ?? null,
      role: (meta.role as Role) ?? 'CITIZEN',
      districts: meta.districts ?? [],
      zones: meta.zones ?? [],
      created_at: row.created_at
    } as UserRow;
  });
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
  const r = await execute('SELECT code, name, default_time_zone FROM countries', [], { prepare: true });
  const rows = r.rows as CountryRow[];
  return rows.map((c) => ({ code: c.code, name: c.name, timeZone: c.default_time_zone })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listStates(countryCode: string): Promise<State[]> {
  const r = await execute('SELECT code, name FROM states WHERE country_code = ?', [countryCode], { prepare: true });
  const rows = r.rows as Array<{ code: string; name: string }>;
  return rows.map((s) => ({ code: s.code, name: s.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDistricts(countryCode: string, stateCode: string): Promise<District[]> {
  const r = await execute('SELECT id, code, name FROM districts_by_state WHERE country_code = ? AND state_code = ?', [countryCode, stateCode], { prepare: true });
  return (r.rows || []).map((d: any) => ({ id: d.id, code: d.code, name: d.name }));
}

export async function getDistrictOfflineManifest(districtId: string): Promise<OfflineManifest | null> {
  const r = await execute('SELECT id, top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng, min_zoom, max_zoom, tile_style_url FROM districts_by_state WHERE id = ? ALLOW FILTERING', [districtId], { prepare: true });
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
  const r = await execute('SELECT id, name, metadata FROM roads_catalog WHERE district_id = ? ALLOW FILTERING', [districtId], { prepare: true });
  return (r.rows || []).map((row: any) => {
    const meta = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      id: row.id,
      name: row.name,
      roadType: meta.road_type ?? '',
      authorityId: meta.authority_id ?? '',
      totalLengthKm: meta.total_length_km ?? 0
    } as RoadCatalogItem;
  });
}

export async function upsertCountry(input: {
  code: string;
  name: string;
  defaultTimeZone: string;
}): Promise<Country> {
  await execute('INSERT INTO countries (code, name, default_time_zone) VALUES (?, ?, ?)', [input.code.toUpperCase(), input.name, input.defaultTimeZone], { prepare: true });
  return { code: input.code.toUpperCase(), name: input.name, timeZone: input.defaultTimeZone };
}

export async function upsertState(input: { countryCode: string; code: string; name: string }): Promise<State & { countryCode: string }> {
  await execute('INSERT INTO states (country_code, code, name) VALUES (?, ?, ?)', [input.countryCode.toUpperCase(), input.code.toUpperCase(), input.name], { prepare: true });
  return { countryCode: input.countryCode.toUpperCase(), code: input.code.toUpperCase(), name: input.name };
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
  await execute(
    'INSERT INTO districts_by_state (country_code, state_code, code, id, name, top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng, min_zoom, max_zoom, tile_style_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      input.countryCode.toUpperCase(),
      input.stateCode.toUpperCase(),
      input.code.toUpperCase(),
      id,
      input.name,
      input.bbox.topLeft.lat,
      input.bbox.topLeft.lng,
      input.bbox.bottomRight.lat,
      input.bbox.bottomRight.lng,
      zoomMin,
      zoomMax,
      input.tileStyleUrl ?? null
    ],
    { prepare: true }
  );
  return { id, code: input.code.toUpperCase(), name: input.name };
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
  const queries = input.roads.map((road) => ({
    query: 'INSERT INTO roads_catalog (id, name, district_id, metadata) VALUES (?, ?, ?, ?) ',
    params: [road.id, road.name, input.districtId, JSON.stringify({ road_type: road.roadType, authority_id: road.authorityId, total_length_km: road.totalLengthKm ?? 0, geometry: road.geometry ?? null })]
  }));
  await client.batch(queries, { prepare: true, logged: true });
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
  await execute(
    'INSERT INTO authority_directory (authority_id, name, department, public_phone, public_email, website, address, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      input.authorityId,
      input.name,
      input.department ?? null,
      input.publicPhone ?? null,
      input.publicEmail ?? null,
      input.website ?? null,
      input.address ?? null,
      updatedAt
    ],
    { prepare: true }
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
  const meta = JSON.stringify({ engineerUserId: input.engineerUserId ?? null, startsOn: input.startsOn ?? null, endsOn: input.endsOn ?? null });
  const now = new Date();
  await execute('INSERT INTO road_assignments (id, road_id, contractor_id, assigned_at, metadata) VALUES (?, ?, ?, ?, ?)', [id, input.roadId, input.contractorId ?? null, now, meta], { prepare: true });
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
