import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { z } from 'zod';

const { Pool } = pg;

dotenv.config();

const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });

const GeoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2)
});

const GeoJsonMultiLineStringSchema = z.object({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)).min(1)
});

const SeedSchema = z.object({
  authorityDirectory: z
    .array(
      z.object({
        authorityId: z.string().min(1),
        name: z.string().min(2),
        department: z.string().min(2).optional(),
        publicPhone: z.string().min(3).optional(),
        publicEmail: z.string().email().optional(),
        website: z.string().url().optional(),
        address: z.string().min(3).optional()
      })
    )
    .default([]),
  contractors: z
    .array(
      z.object({
        id: z.string().min(2),
        name: z.string().min(2),
        registrationNumber: z.string().min(2).optional(),
        contactPhoneMasked: z.string().min(3).optional()
      })
    )
    .default([]),
  roadAssignments: z
    .array(
      z.object({
        roadId: z.string().min(2),
        contractorId: z.string().min(2).optional(),
        engineerUserId: z.string().uuid().optional(),
        startsOn: z.string().min(8).optional(),
        endsOn: z.string().min(8).optional()
      })
    )
    .default([]),
  countries: z
    .array(
      z.object({
        code: z.string().min(2).max(3),
        name: z.string().min(2),
        defaultTimeZone: z.string().min(3),
        states: z
          .array(
            z.object({
              code: z.string().min(1).max(8),
              name: z.string().min(2),
              districts: z
                .array(
                  z.object({
                    id: z.string().uuid().optional(),
                    code: z.string().min(1).max(16),
                    name: z.string().min(2),
                    bbox: z.object({ topLeft: LatLngSchema, bottomRight: LatLngSchema }),
                    zoom: z.object({ min: z.number().int().min(0).max(22), max: z.number().int().min(0).max(22) }).optional(),
                    tileStyleUrl: z.string().url().nullable().optional(),
                    roads: z
                      .array(
                        z.object({
                          id: z.string().min(2),
                          name: z.string().min(2),
                          roadType: z.string().min(1),
                          authorityId: z.string().min(1),
                          totalLengthKm: z.number().optional(),
                          geometry: z.union([GeoJsonLineStringSchema, GeoJsonMultiLineStringSchema]).optional()
                        })
                      )
                      .default([])
                  })
                )
                .default([])
            })
          )
          .default([])
      })
    )
    .default([])
});

type Seed = z.infer<typeof SeedSchema>;

type Args = { file: string };

function parseArgs(argv: string[]): Args {
  const out: Args = { file: resolve('scripts/seeds/india-demo.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') {
      const v = argv[i + 1];
      if (!v) throw new Error('Missing value for --file');
      out.file = resolve(v);
      i++;
      continue;
    }
    if (a === '-h' || a === '--help') {
      // eslint-disable-next-line no-console
      console.log('Usage: pnpm seed:backend --file <path-to-seed.json>');
      process.exit(0);
    }
  }
  return out;
}

async function ensureSchema(pool: pg.Pool) {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

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

  // Incremental additions for road segment overlays + public contacts.
  await pool.query(`ALTER TABLE roads_catalog ADD COLUMN IF NOT EXISTS geometry jsonb;`);

  // Minimal users table to satisfy FK relationships (gateway-api may create a richer schema).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      govt_id text,
      role text
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contractors (
      id text PRIMARY KEY,
      name text NOT NULL,
      registration_number text,
      contact_phone_masked text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

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
  `);

  // Existing dev DBs may have older table definitions; bring them forward safely.
  await pool.query(`
    ALTER TABLE contractors ADD COLUMN IF NOT EXISTS registration_number text;
    ALTER TABLE contractors ADD COLUMN IF NOT EXISTS contact_phone_masked text;
    ALTER TABLE contractors ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE contractors ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    ALTER TABLE authority_directory ADD COLUMN IF NOT EXISTS department text;
    ALTER TABLE authority_directory ADD COLUMN IF NOT EXISTS public_phone text;
    ALTER TABLE authority_directory ADD COLUMN IF NOT EXISTS public_email text;
    ALTER TABLE authority_directory ADD COLUMN IF NOT EXISTS website text;
    ALTER TABLE authority_directory ADD COLUMN IF NOT EXISTS address text;
    ALTER TABLE authority_directory ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    ALTER TABLE road_assignments ADD COLUMN IF NOT EXISTS contractor_id text;
    ALTER TABLE road_assignments ADD COLUMN IF NOT EXISTS engineer_user_id uuid;
    ALTER TABLE road_assignments ADD COLUMN IF NOT EXISTS starts_on date;
    ALTER TABLE road_assignments ADD COLUMN IF NOT EXISTS ends_on date;
    ALTER TABLE road_assignments ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  `);
}

async function upsertCountry(pool: pg.Pool, input: { code: string; name: string; defaultTimeZone: string }) {
  await pool.query(
    `INSERT INTO countries (code, name, default_time_zone)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, default_time_zone = EXCLUDED.default_time_zone;`,
    [input.code.toUpperCase(), input.name, input.defaultTimeZone]
  );
}

async function upsertState(pool: pg.Pool, input: { countryCode: string; code: string; name: string }) {
  await pool.query(
    `INSERT INTO states (country_code, code, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (country_code, code) DO UPDATE SET name = EXCLUDED.name;`,
    [input.countryCode.toUpperCase(), input.code.toUpperCase(), input.name]
  );
}

async function upsertDistrict(
  pool: pg.Pool,
  input: {
    id?: string;
    countryCode: string;
    stateCode: string;
    code: string;
    name: string;
    bbox: { topLeft: { lat: number; lng: number }; bottomRight: { lat: number; lng: number } };
    zoom?: { min: number; max: number };
    tileStyleUrl?: string | null;
  }
): Promise<string> {
  const zoomMin = input.zoom?.min ?? 10;
  const zoomMax = input.zoom?.max ?? 16;

  const r = await pool.query<{ id: string }>(
    `INSERT INTO districts (
       id, country_code, state_code, code, name,
       top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng,
       min_zoom, max_zoom, tile_style_url
     )
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
     RETURNING id;`,
    [
      input.id ?? null,
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
  return r.rows[0]!.id;
}

async function upsertRoad(
  pool: pg.Pool,
  input: {
    districtId: string;
    id: string;
    name: string;
    roadType: string;
    authorityId: string;
    totalLengthKm?: number;
    geometry?: any;
  }
) {
  await pool.query(
    `INSERT INTO roads_catalog (id, district_id, name, road_type, authority_id, total_length_km, geometry)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id)
     DO UPDATE SET
       district_id = EXCLUDED.district_id,
       name = EXCLUDED.name,
       road_type = EXCLUDED.road_type,
       authority_id = EXCLUDED.authority_id,
       total_length_km = EXCLUDED.total_length_km,
       geometry = COALESCE(EXCLUDED.geometry, roads_catalog.geometry);`,
    [input.id, input.districtId, input.name, input.roadType, input.authorityId, input.totalLengthKm ?? 0, input.geometry ? JSON.stringify(input.geometry) : null]
  );
}

async function upsertContractor(
  pool: pg.Pool,
  input: { id: string; name: string; registrationNumber?: string; contactPhoneMasked?: string }
) {
  await pool.query(
    `INSERT INTO contractors (id, name, registration_number, contact_phone_masked)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       registration_number = EXCLUDED.registration_number,
       contact_phone_masked = EXCLUDED.contact_phone_masked,
       updated_at = now();`,
    [input.id, input.name, input.registrationNumber ?? null, input.contactPhoneMasked ?? null]
  );
}

async function upsertAuthorityDirectory(
  pool: pg.Pool,
  input: {
    authorityId: string;
    name: string;
    department?: string;
    publicPhone?: string;
    publicEmail?: string;
    website?: string;
    address?: string;
  }
) {
  await pool.query(
    `INSERT INTO authority_directory (authority_id, name, department, public_phone, public_email, website, address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (authority_id) DO UPDATE SET
       name = EXCLUDED.name,
       department = EXCLUDED.department,
       public_phone = EXCLUDED.public_phone,
       public_email = EXCLUDED.public_email,
       website = EXCLUDED.website,
       address = EXCLUDED.address,
       updated_at = now();`,
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
}

async function createRoadAssignment(
  pool: pg.Pool,
  input: { roadId: string; contractorId?: string; engineerUserId?: string; startsOn?: string; endsOn?: string }
) {
  await pool.query(
    `INSERT INTO road_assignments (road_id, contractor_id, engineer_user_id, starts_on, ends_on)
     VALUES ($1, $2, $3, $4, $5);`,
    [
      input.roadId,
      input.contractorId ?? null,
      input.engineerUserId ?? null,
      input.startsOn ? new Date(input.startsOn).toISOString().slice(0, 10) : null,
      input.endsOn ? new Date(input.endsOn).toISOString().slice(0, 10) : null
    ]
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (same as gateway-api)');
  }

  const seedPath = args.file;
  const raw = await readFile(seedPath, 'utf8');
  const seed = SeedSchema.parse(JSON.parse(raw)) satisfies Seed;

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await ensureSchema(pool);

    let contractorCount = 0;
    let authorityCount = 0;
    let assignmentCount = 0;

    for (const c of seed.contractors) {
      await upsertContractor(pool, c);
      contractorCount++;
    }

    for (const a of seed.authorityDirectory) {
      await upsertAuthorityDirectory(pool, a);
      authorityCount++;
    }

    let countryCount = 0;
    let stateCount = 0;
    let districtCount = 0;
    let roadCount = 0;

    for (const country of seed.countries) {
      await upsertCountry(pool, country);
      countryCount++;

      for (const state of country.states) {
        await upsertState(pool, { countryCode: country.code, code: state.code, name: state.name });
        stateCount++;

        for (const district of state.districts) {
          const districtId = await upsertDistrict(pool, {
            id: district.id,
            countryCode: country.code,
            stateCode: state.code,
            code: district.code,
            name: district.name,
            bbox: district.bbox,
            zoom: district.zoom,
            tileStyleUrl: district.tileStyleUrl
          });
          districtCount++;

          for (const road of district.roads) {
            await upsertRoad(pool, { districtId, ...road });
            roadCount++;
          }
        }
      }
    }

    for (const ra of seed.roadAssignments) {
      await createRoadAssignment(pool, ra);
      assignmentCount++;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[seed-backend] upserted: countries=${countryCount} states=${stateCount} districts=${districtCount} roads=${roadCount} contractors=${contractorCount} authorities=${authorityCount} assignments=${assignmentCount}`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-backend] failed:', err);
  process.exit(1);
});
