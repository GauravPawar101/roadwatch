import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'cassandra-driver';
import { z } from 'zod';

import { randomUUID } from 'crypto';

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

// Schema is created via docker/cassandra/init.cql. This script performs idempotent
// upserts against Cassandra tables using the cassandra-driver client.

async function upsertCountry(client: Client, input: { code: string; name: string; defaultTimeZone: string }) {
  await client.execute('INSERT INTO countries (code, name, default_time_zone) VALUES (?, ?, ?)', [input.code.toUpperCase(), input.name, input.defaultTimeZone], { prepare: true });
}

async function upsertState(client: Client, input: { countryCode: string; code: string; name: string }) {
  await client.execute('INSERT INTO states (country_code, code, name) VALUES (?, ?, ?)', [input.countryCode.toUpperCase(), input.code.toUpperCase(), input.name], { prepare: true });
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

  const id = input.id ?? randomUUID();
  await client.execute(
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
  return id;
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
  await client.execute('INSERT INTO roads_catalog (id, name, district_id, metadata) VALUES (?, ?, ?, ?)', [
    input.id,
    input.name,
    input.districtId,
    JSON.stringify({ road_type: input.roadType, authority_id: input.authorityId, total_length_km: input.totalLengthKm ?? 0, geometry: input.geometry ?? null })
  ], { prepare: true });
}

async function upsertContractor(
  pool: pg.Pool,
  input: { id: string; name: string; registrationNumber?: string; contactPhoneMasked?: string }
) {
  await client.execute('INSERT INTO contractors (id, name, metadata, created_at) VALUES (?, ?, ?, ?)', [
    input.id,
    input.name,
    JSON.stringify({ registrationNumber: input.registrationNumber ?? null, contactPhoneMasked: input.contactPhoneMasked ?? null }),
    new Date()
  ], { prepare: true });
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
  await client.execute('INSERT INTO authority_directory (authority_id, name, department, public_phone, public_email, website, address, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    input.authorityId,
    input.name,
    input.department ?? null,
    input.publicPhone ?? null,
    input.publicEmail ?? null,
    input.website ?? null,
    input.address ?? null,
    new Date()
  ], { prepare: true });
}

async function createRoadAssignment(
  pool: pg.Pool,
  input: { roadId: string; contractorId?: string; engineerUserId?: string; startsOn?: string; endsOn?: string }
) {
  const id = randomUUID();
  const meta = JSON.stringify({ engineerUserId: input.engineerUserId ?? null, startsOn: input.startsOn ?? null, endsOn: input.endsOn ?? null });
  await client.execute('INSERT INTO road_assignments (id, road_id, contractor_id, assigned_at, metadata) VALUES (?, ?, ?, ?, ?)', [id, input.roadId, input.contractorId ?? null, new Date(), meta], { prepare: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042').split(',');
  const keyspace = process.env.CASSANDRA_KEYSPACE || 'roadwatch';
  const localDc = process.env.CASSANDRA_LOCAL_DC || 'datacenter1';
  const seedPath = args.file;
  const raw = await readFile(seedPath, 'utf8');
  const seed = SeedSchema.parse(JSON.parse(raw)) satisfies Seed;

  const client = new Client({ contactPoints: contactPoints.map((c) => c.split(':')[0]), localDataCenter: localDc, keyspace });
  await client.connect();
  try {

    let contractorCount = 0;
    let authorityCount = 0;
    let assignmentCount = 0;

    for (const c of seed.contractors) {
      await upsertContractor(client, c);
      contractorCount++;
    }

    for (const a of seed.authorityDirectory) {
      await upsertAuthorityDirectory(client, a);
      authorityCount++;
    }

    let countryCount = 0;
    let stateCount = 0;
    let districtCount = 0;
    let roadCount = 0;

    for (const country of seed.countries) {
      await upsertCountry(client, country);
      countryCount++;

      for (const state of country.states) {
        await upsertState(client, { countryCode: country.code, code: state.code, name: state.name });
        stateCount++;

        for (const district of state.districts) {
          const districtId = await upsertDistrict(client, {
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
            await upsertRoad(client, { districtId, ...road });
            roadCount++;
          }
        }
      }
    }

    for (const ra of seed.roadAssignments) {
      await createRoadAssignment(client, ra);
      assignmentCount++;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[seed-backend] upserted: countries=${countryCount} states=${stateCount} districts=${districtCount} roads=${roadCount} contractors=${contractorCount} authorities=${authorityCount} assignments=${assignmentCount}`
    );
  } finally {
    await client.shutdown();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-backend] failed:', err);
  process.exit(1);
});
