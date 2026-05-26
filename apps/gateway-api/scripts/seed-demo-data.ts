import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { appendFile } from 'fs/promises';

dotenv.config();
process.env.ROADWATCH_SKIP_MINI_SEED = '1';

let pool: {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number; rows?: Array<Record<string, unknown>> }>;
};

let trackAnalyticsEvent: (input: Record<string, unknown>) => Promise<void>;

type DistrictSeed = {
  stateCode: string;
  stateName: string;
  districtName: string;
  districtCode: string;
  authorityId: string;
  authorityName: string;
  center: { lat: number; lng: number };
  complaintCount: number;
  zones: string[];
  roads: Array<{ id: string; name: string; roadType: string; totalLengthKm: number }>;
};

type SeedUser = {
  id: string;
  phone: string;
  maskedPhone: string;
  username: string;
  role: 'CE' | 'EE' | 'CONTRACTOR' | 'CITIZEN';
  districts: string[];
  zones: string[];
  govtId: string;
  label: string;
};

type SeedContractor = {
  id: string;
  name: string;
  registrationNumber: string;
  contactPhoneMasked: string;
  districts: string[];
  zones: string[];
};

type SeedComplaint = {
  id: string;
  district: string;
  zone: string;
  roadId: string;
  authorityId: string;
  contractorId: string;
  citizen: SeedUser;
  officer: SeedUser;
  status: 'FILED' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';
  description: string;
  lat: number;
  lng: number;
  createdAt: Date;
  assignedAt: Date;
  updatedAt: Date;
  expectedResolutionDays: number;
  aiScore: number;
  repaired: boolean;
};

function mulberry32(seed: number) {
  return function next() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function phoneFromIndex(base: string, index: number) {
  return `+91${base}${String(index).padStart(4, '0')}`;
}

function buildBoundingBox(center: { lat: number; lng: number }, spreadLat = 0.18, spreadLng = 0.22) {
  return {
    topLeft: { lat: center.lat + spreadLat, lng: center.lng - spreadLng },
    bottomRight: { lat: center.lat - spreadLat, lng: center.lng + spreadLng }
  };
}

function buildRoadGeometry(center: { lat: number; lng: number }, variant: number) {
  const deltaLat = 0.018 + variant * 0.004;
  const deltaLng = 0.022 + variant * 0.005;
  return {
    type: 'LineString',
    coordinates: [
      [Number((center.lng - deltaLng).toFixed(6)), Number((center.lat - deltaLat).toFixed(6))],
      [Number((center.lng - deltaLng / 3).toFixed(6)), Number((center.lat - deltaLat / 4).toFixed(6))],
      [Number((center.lng + deltaLng / 4).toFixed(6)), Number((center.lat + deltaLat / 5).toFixed(6))],
      [Number((center.lng + deltaLng).toFixed(6)), Number((center.lat + deltaLat).toFixed(6))]
    ]
  };
}

function offsetPoint(center: { lat: number; lng: number }, rng: () => number) {
  const lat = center.lat + (rng() - 0.5) * 0.02;
  const lng = center.lng + (rng() - 0.5) * 0.02;
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6))
  };
}

function complaintStatus(index: number): SeedComplaint['status'] {
  const cycle = ['RESOLVED', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'FILED', 'RESOLVED'] as const;
  return cycle[index % cycle.length];
}

const districtSeeds: DistrictSeed[] = [
  {
    stateCode: 'DL',
    stateName: 'Delhi',
    districtName: 'New Delhi',
    districtCode: 'DL-ND',
    authorityId: 'AUTH-DL',
    authorityName: 'Delhi PWD',
    center: { lat: 28.614, lng: 77.209 },
    complaintCount: 18,
    zones: ['Central', 'Lutyens'],
    roads: [
      { id: 'SEED-RD-DL-ND-01', name: 'Ring Road', roadType: 'ARTERIAL', totalLengthKm: 48 },
      { id: 'SEED-RD-DL-ND-02', name: 'Outer Ring Connector', roadType: 'ARTERIAL', totalLengthKm: 21 }
    ]
  },
  {
    stateCode: 'DL',
    stateName: 'Delhi',
    districtName: 'South Delhi',
    districtCode: 'DL-SD',
    authorityId: 'AUTH-DL',
    authorityName: 'Delhi PWD',
    center: { lat: 28.5355, lng: 77.24 },
    complaintCount: 12,
    zones: ['South', 'Okhla'],
    roads: [
      { id: 'SEED-RD-DL-SD-01', name: 'Aurobindo Marg', roadType: 'ARTERIAL', totalLengthKm: 17 },
      { id: 'SEED-RD-DL-SD-02', name: 'Mahatma Gandhi Road', roadType: 'COLLECTOR', totalLengthKm: 12 }
    ]
  },
  {
    stateCode: 'MH',
    stateName: 'Maharashtra',
    districtName: 'Mumbai',
    districtCode: 'MH-MUM',
    authorityId: 'AUTH-MH',
    authorityName: 'Maharashtra PWD',
    center: { lat: 19.076, lng: 72.8777 },
    complaintCount: 10,
    zones: ['West', 'Coastal'],
    roads: [
      { id: 'SEED-RD-MH-MUM-01', name: 'Western Express Highway', roadType: 'HIGHWAY', totalLengthKm: 25 },
      { id: 'SEED-RD-MH-MUM-02', name: 'Eastern Express Highway', roadType: 'HIGHWAY', totalLengthKm: 22 }
    ]
  },
  {
    stateCode: 'MH',
    stateName: 'Maharashtra',
    districtName: 'Pune',
    districtCode: 'MH-PUN',
    authorityId: 'AUTH-MH',
    authorityName: 'Maharashtra PWD',
    center: { lat: 18.5204, lng: 73.8567 },
    complaintCount: 8,
    zones: ['Pune-East', 'Pune-West'],
    roads: [
      { id: 'SEED-RD-MH-PUN-01', name: 'University Road', roadType: 'COLLECTOR', totalLengthKm: 11 },
      { id: 'SEED-RD-MH-PUN-02', name: 'Sinhagad Road', roadType: 'ARTERIAL', totalLengthKm: 14 }
    ]
  },
  {
    stateCode: 'UP',
    stateName: 'Uttar Pradesh',
    districtName: 'Lucknow',
    districtCode: 'UP-LKO',
    authorityId: 'AUTH-UP',
    authorityName: 'Uttar Pradesh PWD',
    center: { lat: 26.8467, lng: 80.9462 },
    complaintCount: 8,
    zones: ['Trans-Gomti', 'Central'],
    roads: [
      { id: 'SEED-RD-UP-LKO-01', name: 'Gomti Nagar Link Road', roadType: 'ARTERIAL', totalLengthKm: 13 },
      { id: 'SEED-RD-UP-LKO-02', name: 'Sitapur Road', roadType: 'ARTERIAL', totalLengthKm: 19 }
    ]
  },
  {
    stateCode: 'UP',
    stateName: 'Uttar Pradesh',
    districtName: 'Noida',
    districtCode: 'UP-NOI',
    authorityId: 'AUTH-UP',
    authorityName: 'Uttar Pradesh PWD',
    center: { lat: 28.535, lng: 77.391 },
    complaintCount: 6,
    zones: ['Sector-18', 'Greater Noida'],
    roads: [
      { id: 'SEED-RD-UP-NOI-01', name: 'Noida Expressway', roadType: 'HIGHWAY', totalLengthKm: 25 },
      { id: 'SEED-RD-UP-NOI-02', name: 'Dadri Main Road', roadType: 'COLLECTOR', totalLengthKm: 8 }
    ]
  },
  {
    stateCode: 'KA',
    stateName: 'Karnataka',
    districtName: 'Bengaluru Urban',
    districtCode: 'KA-BRU',
    authorityId: 'AUTH-KA',
    authorityName: 'Karnataka PWD',
    center: { lat: 12.9716, lng: 77.5946 },
    complaintCount: 5,
    zones: ['Central', 'East'],
    roads: [
      { id: 'SEED-RD-KA-BRU-01', name: 'Outer Ring Road', roadType: 'ARTERIAL', totalLengthKm: 62 },
      { id: 'SEED-RD-KA-BRU-02', name: 'Airport Road', roadType: 'ARTERIAL', totalLengthKm: 16 }
    ]
  },
  {
    stateCode: 'TN',
    stateName: 'Tamil Nadu',
    districtName: 'Chennai',
    districtCode: 'TN-CHE',
    authorityId: 'AUTH-TN',
    authorityName: 'Tamil Nadu PWD',
    center: { lat: 13.0827, lng: 80.2707 },
    complaintCount: 5,
    zones: ['North', 'South'],
    roads: [
      { id: 'SEED-RD-TN-CHE-01', name: 'Anna Salai', roadType: 'ARTERIAL', totalLengthKm: 11 },
      { id: 'SEED-RD-TN-CHE-02', name: 'OMR', roadType: 'HIGHWAY', totalLengthKm: 45 }
    ]
  }
];

const adminSeed: SeedUser = {
  id: 'SEED-ADMIN-01',
  phone: phoneFromIndex('990000', 1),
  maskedPhone: '+91-99XXXX0001',
  username: 'admin.ce',
  role: 'CE',
  districts: ['ALL'],
  zones: ['ALL'],
  govtId: 'ADM-001',
  label: 'Admin / CE'
};

const officerSeeds: SeedUser[] = [
  ['New Delhi', 'South Delhi'],
  ['Mumbai'],
  ['Pune'],
  ['Lucknow'],
  ['Noida'],
  ['Bengaluru Urban'],
  ['Chennai'],
  ['New Delhi'],
  ['Mumbai', 'Pune'],
  ['Lucknow', 'Noida']
].map((districts, index) => ({
  id: `SEED-OFFICER-${String(index + 1).padStart(2, '0')}`,
  phone: phoneFromIndex('991000', index + 1),
  maskedPhone: `+91-99XXXX${String(index + 1).padStart(4, '0')}`,
  username: `ee.${slugify(districts.join('-'))}.${String(index + 1).padStart(2, '0')}`,
  role: 'EE',
  districts,
  zones: ['ALL'],
  govtId: `OFF-${String(index + 1).padStart(3, '0')}`,
  label: `District Officer ${index + 1}`
}));

const citizenDistricts = [
  'New Delhi', 'South Delhi', 'Mumbai', 'Pune', 'Lucknow',
  'Noida', 'Bengaluru Urban', 'Chennai', 'New Delhi', 'Mumbai',
  'Pune', 'Lucknow', 'Noida', 'Bengaluru Urban', 'Chennai',
  'New Delhi', 'South Delhi', 'Mumbai', 'Pune', 'Lucknow'
];

const citizenSeeds: SeedUser[] = citizenDistricts.map((district, index) => ({
  id: `SEED-CITIZEN-${String(index + 1).padStart(2, '0')}`,
  phone: phoneFromIndex('992000', index + 1),
  maskedPhone: `+91-98XXXX${String(index + 1).padStart(4, '0')}`,
  username: `citizen.${String(index + 1).padStart(2, '0')}`,
  role: 'CITIZEN',
  districts: [district],
  zones: ['ALL'],
  govtId: `CIT-${String(index + 1).padStart(3, '0')}`,
  label: `Citizen ${index + 1}`
}));

const contractorSeeds: SeedContractor[] = [
  { id: 'SEED-CTR-01', name: 'SuperBuild Infra', registrationNumber: 'CTR-0001', contactPhoneMasked: '+91-98XXXX1001', districts: ['New Delhi', 'South Delhi'], zones: ['Central', 'South'] },
  { id: 'SEED-CTR-02', name: 'Delta Roads Pvt Ltd', registrationNumber: 'CTR-0002', contactPhoneMasked: '+91-98XXXX1002', districts: ['Mumbai'], zones: ['West', 'Coastal'] },
  { id: 'SEED-CTR-03', name: 'Northline Infrastructure', registrationNumber: 'CTR-0003', contactPhoneMasked: '+91-98XXXX1003', districts: ['Pune'], zones: ['Pune-East', 'Pune-West'] },
  { id: 'SEED-CTR-04', name: 'Gomti Civil Works', registrationNumber: 'CTR-0004', contactPhoneMasked: '+91-98XXXX1004', districts: ['Lucknow'], zones: ['Trans-Gomti', 'Central'] },
  { id: 'SEED-CTR-05', name: 'Yamuna Buildcon', registrationNumber: 'CTR-0005', contactPhoneMasked: '+91-98XXXX1005', districts: ['Noida'], zones: ['Sector-18', 'Greater Noida'] },
  { id: 'SEED-CTR-06', name: 'Metro Grid Works', registrationNumber: 'CTR-0006', contactPhoneMasked: '+91-98XXXX1006', districts: ['Bengaluru Urban'], zones: ['Central', 'East'] },
  { id: 'SEED-CTR-07', name: 'Coromandel Roads', registrationNumber: 'CTR-0007', contactPhoneMasked: '+91-98XXXX1007', districts: ['Chennai'], zones: ['North', 'South'] },
  { id: 'SEED-CTR-08', name: 'UrbanLift Infra', registrationNumber: 'CTR-0008', contactPhoneMasked: '+91-98XXXX1008', districts: ['New Delhi'], zones: ['Lutyens', 'Central'] },
  { id: 'SEED-CTR-09', name: 'Peakline Projects', registrationNumber: 'CTR-0009', contactPhoneMasked: '+91-98XXXX1009', districts: ['Mumbai', 'Pune'], zones: ['West', 'Pune-West'] },
  { id: 'SEED-CTR-10', name: 'Delta East Maintenance', registrationNumber: 'CTR-0010', contactPhoneMasked: '+91-98XXXX1010', districts: ['Lucknow', 'Noida'], zones: ['Trans-Gomti', 'Sector-18'] }
];

const contractorUserSeeds: SeedUser[] = contractorSeeds.map((contractor, index) => ({
  id: `SEED-CTR-USER-${String(index + 1).padStart(2, '0')}`,
  phone: phoneFromIndex('993000', index + 1),
  maskedPhone: `+91-97XXXX${String(index + 1).padStart(4, '0')}`,
  username: slugify(contractor.name),
  role: 'CONTRACTOR',
  districts: contractor.districts,
  zones: contractor.zones,
  govtId: `CTR-USER-${String(index + 1).padStart(3, '0')}`,
  label: `${contractor.name} Access`
}));

const seededRoadIds = districtSeeds.flatMap((district) => district.roads.map((road) => road.id));
const seededContractorIds = contractorSeeds.map((contractor) => contractor.id);

function makeComplaintDescription(district: string, roadName: string, index: number) {
  const patterns = [
    'deep pothole',
    'broken shoulder edge',
    'drain cover failure',
    'surface cracking',
    'waterlogging patch',
    'loose gravel patch'
  ];
  return `${patterns[index % patterns.length]} reported on ${roadName} in ${district}`;
}

function complaintCountSummary() {
  return districtSeeds.reduce((sum, district) => sum + district.complaintCount, 0);
}

async function cleanupSeedRows(
  complaintIds: string[],
  roadIds: string[],
  contractorIds: string[]
) {
  if (complaintIds.length > 0) {
    await pool.query(
      `DELETE FROM analytics_events WHERE id = ANY($1)`,
      [complaintIds]
    ).catch(() => null);
    await pool.query(
      `DELETE FROM authority_action_logs WHERE complaint_id = ANY($1)`,
      [complaintIds]
    ).catch(() => null);
    await pool.query(
      `DELETE FROM complaints WHERE id = ANY($1)`,
      [complaintIds]
    ).catch(() => null);
  }

  if (roadIds.length > 0) {
    await pool.query(
      `DELETE FROM road_assignments WHERE road_id = ANY($1)`,
      [roadIds]
    ).catch(() => null);
  }

  if (contractorIds.length > 0) {
    await pool.query(
      `DELETE FROM contractors WHERE id = ANY($1)`,
      [contractorIds]
    ).catch(() => null);
  }
}

async function insertComplaint(params: {
  complaint: SeedComplaint;
  user: SeedUser & { dbId: string };
  officer: SeedUser & { dbId: string };
  contractor: SeedContractor;
}) {
  const { complaint, user, officer, contractor } = params;

  const complaintMetadata = {
    district: complaint.district,
    zone: complaint.zone,
    description: complaint.description,
    lat: complaint.lat,
    lng: complaint.lng,
    road_id: complaint.roadId,
    authority_id: complaint.authorityId,
    created_at: complaint.createdAt.toISOString(),
    updated_at: complaint.updatedAt.toISOString(),
    fabric_txid: `SEED-TX-${complaint.id}`
  };

  await pool.query(
    `INSERT INTO complaints (id, status, metadata, anchored_tx_hash, anchored_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           metadata = EXCLUDED.metadata,
           anchored_tx_hash = EXCLUDED.anchored_tx_hash,
           anchored_at = EXCLUDED.anchored_at,
           updated_at = EXCLUDED.updated_at`,
    [
      complaint.id,
      complaint.status,
      complaintMetadata,
      `SEED-TX-${complaint.id}`,
      complaint.assignedAt,
      complaint.updatedAt
    ]
  );

  const assignmentMetadata = {
    complaintId: complaint.id,
    expectedResolutionDays: complaint.expectedResolutionDays,
    assignedBy: officer.dbId,
    notes: { seeded: true, citizenId: user.dbId, officerId: officer.dbId }
  };

  await pool.query(
    `INSERT INTO road_assignments (id, road_id, contractor_id, assigned_at, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET road_id = EXCLUDED.road_id,
           contractor_id = EXCLUDED.contractor_id,
           assigned_at = EXCLUDED.assigned_at,
           metadata = EXCLUDED.metadata`,
    [
      `ASSIGN-${complaint.id}`,
      complaint.roadId,
      contractor.id,
      complaint.assignedAt,
      assignmentMetadata
    ]
  );

  await pool.query(
    `INSERT INTO authority_action_logs (id, complaint_id, authority_id, action_type, action_data, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [
      complaint.id,
      complaint.authorityId,
      'COMPLAINT_ASSIGNED',
      {
        contractorId: contractor.id,
        expectedResolutionDays: complaint.expectedResolutionDays,
        assignedBy: officer.dbId
      },
      complaint.assignedAt
    ]
  );

  await trackAnalyticsEvent({
    type: 'COMPLAINT_CREATED',
    actorUserId: user.dbId,
    complaintId: complaint.id,
    contractorId: contractor.id,
    district: complaint.district,
    zone: complaint.zone,
    lat: complaint.lat,
    lng: complaint.lng,
    occurredAt: complaint.createdAt,
    properties: { roadId: complaint.roadId, seeded: true }
  });

  await trackAnalyticsEvent({
    type: 'COMPLAINT_ASSIGNED',
    actorUserId: officer.dbId,
    complaintId: complaint.id,
    contractorId: contractor.id,
    district: complaint.district,
    zone: complaint.zone,
    occurredAt: complaint.assignedAt,
    properties: { expectedResolutionDays: complaint.expectedResolutionDays }
  });

  if (complaint.status === 'RESOLVED' || complaint.status === 'ESCALATED') {
    const action = complaint.status === 'RESOLVED' ? 'COMPLAINT_RESOLVED' : 'COMPLAINT_ESCALATED';

    await pool.query(
      `INSERT INTO authority_action_logs (id, complaint_id, authority_id, action_type, action_data, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [
        complaint.id,
        complaint.authorityId,
        action,
        { contractorId: contractor.id, status: complaint.status },
        complaint.updatedAt
      ]
    );

    await trackAnalyticsEvent({
      type: complaint.status === 'RESOLVED' ? 'COMPLAINT_RESOLVED' : 'COMPLAINT_ESCALATED',
      actorUserId: officer.dbId,
      complaintId: complaint.id,
      contractorId: contractor.id,
      district: complaint.district,
      zone: complaint.zone,
      occurredAt: complaint.updatedAt,
      properties: { seeded: true }
    });
  }

  if (complaint.status === 'IN_PROGRESS' && complaint.expectedResolutionDays >= 10) {
    const warningAt = new Date(complaint.updatedAt.getTime() + 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO authority_action_logs (id, complaint_id, authority_id, action_type, action_data, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [
        complaint.id,
        complaint.authorityId,
        'SLA_WARNING',
        { contractorId: contractor.id, warning: 'seeded' },
        warningAt
      ]
    );

    await trackAnalyticsEvent({
      type: 'SLA_WARNING',
      actorUserId: officer.dbId,
      complaintId: complaint.id,
      contractorId: contractor.id,
      district: complaint.district,
      zone: complaint.zone,
      occurredAt: warningAt,
      properties: { seeded: true }
    });
  }

  if (complaint.repaired) {
    const beforeHash = `before-${complaint.id}`;
    const afterHash = `after-${complaint.id}`;

    const existing = await pool.query(
      `SELECT metadata FROM complaints WHERE id = $1`,
      [complaint.id]
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

    const meta: Record<string, unknown> = (existing.rows[0]?.metadata as Record<string, unknown>) ?? {};
    const repairVerifications: unknown[] = Array.isArray(meta.repair_verifications)
      ? (meta.repair_verifications as unknown[])
      : [];

    repairVerifications.push({
      before: beforeHash,
      after: afterHash,
      image_lat: complaint.lat,
      image_lng: complaint.lng,
      current_lat: complaint.lat + 0.0002,
      current_lng: complaint.lng + 0.0002,
      distance_m: 12,
      ai_score: complaint.aiScore,
      repaired: true,
      model: 'roadwatch-repair-ai-v1',
      details: { seeded: true, contractorId: contractor.id },
      verified_by: officer.dbId,
      verified_at: complaint.updatedAt.toISOString()
    });

    meta.repair_verifications = repairVerifications;

    await pool.query(
      `UPDATE complaints SET metadata = $1 WHERE id = $2`,
      [meta, complaint.id]
    );
  }
}

async function main() {
  const {
    bulkUpsertRoads,
    initDb,
    pool: importedPool,
    createRoadAssignment,
    upsertAuthorityDirectory,
    upsertCountry,
    upsertDistrict,
    upsertState,
    upsertUser,
    getUserByPhone,
    createContractor
  } = await import('../src/db.js');
  const { trackAnalyticsEvent: analyticsTrackEvent } = await import('../src/analytics/service.js');

  pool = importedPool;
  trackAnalyticsEvent = analyticsTrackEvent;

  await initDb();

  // --- Clean up any previously-seeded demo data ---
  try {
    const seededRoadIdsLocal = typeof seededRoadIds !== 'undefined'
      ? seededRoadIds
      : districtSeeds.flatMap((d) => d.roads.map((r) => r.id));
    const seededContractorIdsLocal = typeof seededContractorIds !== 'undefined'
      ? seededContractorIds
      : contractorSeeds.map((c) => c.id);

    await cleanupSeedRows([], seededRoadIdsLocal, seededContractorIdsLocal).catch(() => null);

    const seededPhones = [
      adminSeed.phone,
      ...officerSeeds.map((s) => s.phone),
      ...citizenSeeds.map((s) => s.phone),
      ...contractorUserSeeds.map((s) => s.phone)
    ];

    for (const phone of seededPhones) {
      const u = await getUserByPhone(phone).catch(() => null);
      if (u && u.id) {
        await pool.query(`DELETE FROM users WHERE id = $1`, [u.id]).catch(() => null);
      }
    }
  } catch (err) {
    console.warn('Seed cleanup warning:', err);
  }

  const authorityEntries = Array.from(
    new Map(districtSeeds.map((district) => [district.authorityId, district.authorityName])).entries()
  );
  for (const [authorityId, authorityName] of authorityEntries) {
    await upsertAuthorityDirectory({
      authorityId,
      name: authorityName,
      department: 'Roads & Maintenance',
      publicPhone: '+91-11-XXXX-XXXX',
      publicEmail: `${slugify(authorityName)}@roadwatch.example`,
      website: `https://${slugify(authorityName)}.example`,
      address: authorityName.includes('Delhi')
        ? 'New Delhi'
        : authorityName.includes('Maharashtra')
        ? 'Mumbai'
        : authorityName.includes('Uttar')
        ? 'Lucknow'
        : authorityName.includes('Karnataka')
        ? 'Bengaluru'
        : 'Chennai'
    });
  }

  await upsertCountry({ code: 'IN', name: 'India', defaultTimeZone: 'Asia/Kolkata' });

  for (const district of districtSeeds) {
    await upsertState({ countryCode: 'IN', code: district.stateCode, name: district.stateName });
    const districtRow = await upsertDistrict({
      countryCode: 'IN',
      stateCode: district.stateCode,
      code: district.districtCode,
      name: district.districtName,
      bbox: buildBoundingBox(district.center)
    });

    await bulkUpsertRoads({
      districtId: districtRow.id,
      roads: district.roads.map((road, index) => ({
        ...road,
        authorityId: district.authorityId,
        geometry: buildRoadGeometry(district.center, index)
      }))
    });
  }

  const admin = await upsertUser({
    phone: adminSeed.phone,
    username: adminSeed.username,
    role: adminSeed.role,
    govtId: adminSeed.govtId,
    districts: adminSeed.districts,
    zones: adminSeed.zones
  });

  const officers: Array<SeedUser & { dbId: string }> = [];
  for (const seed of officerSeeds) {
    const user = await upsertUser({
      phone: seed.phone,
      username: seed.username,
      role: seed.role,
      govtId: seed.govtId,
      districts: seed.districts,
      zones: seed.zones
    });
    officers.push({ ...seed, dbId: user.id });
  }

  const citizens: Array<SeedUser & { dbId: string }> = [];
  for (const seed of citizenSeeds) {
    const user = await upsertUser({
      phone: seed.phone,
      username: seed.username,
      role: seed.role,
      govtId: seed.govtId,
      districts: seed.districts,
      zones: seed.zones
    });
    citizens.push({ ...seed, dbId: user.id });
  }

  const contractorUsers: Array<SeedUser & { dbId: string }> = [];
  for (const seed of contractorUserSeeds) {
    const user = await upsertUser({
      phone: seed.phone,
      username: seed.username,
      email: `${seed.username}@roadwatch.local`,
      role: seed.role,
      govtId: seed.govtId,
      districts: seed.districts,
      zones: seed.zones
    });
    contractorUsers.push({ ...seed, dbId: user.id });
  }

  // --- Create password-backed test accounts ---
  try {
    const outPath = '../../test-acc.txt';
    const testPassword = 'pass@123';
    const pwHash = (p: string) => bcrypt.hashSync(p, 8);

    const rowsToUpdate: Array<{ id: string; username?: string | null; email?: string | null; phone?: string | null; role: string }> = [];
    if (admin && admin.id) rowsToUpdate.push({ id: admin.id, username: adminSeed.username, phone: adminSeed.phone, role: adminSeed.role });
    for (const o of officers.slice(0, 3)) rowsToUpdate.push({ id: o.dbId, username: o.username, phone: o.phone, role: o.role });
    for (const c of citizens.slice(0, 3)) rowsToUpdate.push({ id: c.dbId, username: c.username, phone: c.phone, role: c.role });
    for (const cu of contractorUsers.slice(0, 3)) rowsToUpdate.push({ id: cu.dbId, username: cu.username, email: `${cu.username}@roadwatch.local`, phone: cu.phone, role: cu.role });

    let output = '\n--- Auto-added test credentials (seed-demo-data) ---\n';
    for (const r of rowsToUpdate) {
      const hash = pwHash(testPassword);

      // Read current metadata, merge password fields, write back
      const existing = await pool.query(
        `SELECT metadata FROM users WHERE id = $1`,
        [r.id]
      ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

      const meta: Record<string, unknown> = (existing.rows[0]?.metadata as Record<string, unknown>) ?? {};
      meta.password_hash = hash;
      meta.signup_method = 'username';

      await pool.query(
        `UPDATE users SET metadata = $1, updated_at = $2 WHERE id = $3`,
        [meta, new Date(), r.id]
      );

      output += `Role: ${r.role}\n`;
      if (r.username) output += `  username: ${r.username}\n`;
      if (r.email) output += `  email: ${r.email}\n`;
      if (r.phone) output += `  phone: ${r.phone}\n`;
      output += `  password: ${testPassword}\n\n`;
    }

    await appendFile(outPath, output, { encoding: 'utf8' });
  } catch (err) {
    console.error('Failed to write test credentials to file:', err);
  }

  for (const contractor of contractorSeeds) {
    await createContractor({
      companyName: contractor.name,
      registrationNumber: contractor.registrationNumber,
      contactPhoneMasked: contractor.contactPhoneMasked,
      districts: contractor.districts,
      zones: contractor.zones
    });
  }

  // Build roadsByDistrict from seed list
  const roadsByDistrict = new Map<string, Array<{ id: string; name: string; authorityId: string }>>();
  for (const district of districtSeeds) {
    roadsByDistrict.set(
      district.districtName,
      district.roads.map((r) => ({ id: r.id, name: r.name, authorityId: district.authorityId }))
    );
  }

  const complaintPattern = Array.from(
    { length: complaintCountSummary() },
    (_, index) => `SEED-COMP-${String(index + 1).padStart(3, '0')}`
  );
  await cleanupSeedRows(complaintPattern, [], []);

  const rng = mulberry32(0x524f4144);
  const complaints: SeedComplaint[] = [];
  let complaintIndex = 0;
  let officerCursor = 0;
  let contractorCursor = 0;
  const baseDate = new Date('2026-03-01T08:00:00.000Z');

  for (const district of districtSeeds) {
    const districtRoads = roadsByDistrict.get(district.districtName) ?? [];
    for (let i = 0; i < district.complaintCount; i++) {
      const citizen = citizens[complaintIndex % citizens.length]!;
      const officer = officers[officerCursor % officers.length]!;
      const contractor = contractorSeeds[contractorCursor % contractorSeeds.length]!;
      const road = districtRoads[i % districtRoads.length] ?? {
        id: district.roads[0]!.id,
        name: district.roads[0]!.name,
        authorityId: district.authorityId
      };
      const createdAt = new Date(baseDate.getTime() + complaintIndex * 7 * 60 * 60 * 1000);
      const assignedAt = new Date(createdAt.getTime() + 6 * 60 * 60 * 1000);
      const status = complaintStatus(complaintIndex);
      const resolutionDeltaDays =
        status === 'RESOLVED' ? 2 + (complaintIndex % 8)
        : status === 'ESCALATED' ? 4 + (complaintIndex % 3)
        : 1 + (complaintIndex % 2);
      const updatedAt = new Date(assignedAt.getTime() + resolutionDeltaDays * 24 * 60 * 60 * 1000);
      const location = offsetPoint(district.center, rng);
      const expectedResolutionDays = status === 'ESCALATED' ? 4 : status === 'IN_PROGRESS' ? 10 : 7;
      const aiScore = Number((0.45 + rng() * 0.5).toFixed(2));

      complaints.push({
        id: complaintPattern[complaintIndex]!,
        district: district.districtName,
        zone: district.zones[complaintIndex % district.zones.length]!,
        roadId: road.id,
        authorityId: district.authorityId,
        contractorId: contractor.id,
        citizen,
        officer,
        status,
        description: makeComplaintDescription(district.districtName, road.name, complaintIndex),
        lat: location.lat,
        lng: location.lng,
        createdAt,
        assignedAt,
        updatedAt,
        expectedResolutionDays,
        aiScore,
        repaired: status === 'RESOLVED' || (status === 'IN_PROGRESS' && complaintIndex % 3 === 0)
      });

      officerCursor += 1;
      contractorCursor += 1;
      complaintIndex += 1;
    }
  }

  const seededComplaints = complaints.slice();
  await cleanupSeedRows(seededComplaints.map((item) => item.id), [], []);

  for (const complaint of seededComplaints) {
    const citizen = complaint.citizen;
    const officer = complaint.officer;
    const contractor = contractorSeeds.find((item) => item.id === complaint.contractorId)!;
    await insertComplaint({ complaint, user: citizen, officer, contractor });
  }

  for (const district of districtSeeds) {
    const districtRoads = district.roads.map((road) => road.id);
    const officer = officers.find((item) => item.districts.includes(district.districtName)) ?? officers[0]!;
    const contractor = contractorSeeds.find((item) => item.districts.includes(district.districtName)) ?? contractorSeeds[0]!;
    for (const roadId of districtRoads) {
      await createRoadAssignment({
        roadId,
        contractorId: contractor.id,
        engineerUserId: officer.dbId,
        startsOn: '2026-01-01',
        endsOn: '2026-12-31'
      });
    }
  }

  // Build employee summary
  const employees = [admin, ...officers, ...contractorUsers];
  const employeeStats = new Map<string, { id: string; role: string; assigned: number; resolved: number; escalated: number; sla_warnings: number }>();
  for (const e of employees) {
    employeeStats.set(e.id, { id: e.id, role: e.role, assigned: 0, resolved: 0, escalated: 0, sla_warnings: 0 });
  }
  for (const c of seededComplaints) {
    const officerUser = officers.find((o) => o.dbId === c.officer.dbId) ?? admin;
    const stat = employeeStats.get(officerUser.dbId) ?? { id: officerUser.dbId, role: officerUser.role, assigned: 0, resolved: 0, escalated: 0, sla_warnings: 0 };
    stat.assigned += 1;
    if (c.status === 'RESOLVED') stat.resolved += 1;
    if (c.status === 'ESCALATED') stat.escalated += 1;
    if (c.status === 'IN_PROGRESS' && c.expectedResolutionDays >= 10) stat.sla_warnings += 1;
    employeeStats.set(officerUser.dbId, stat);
  }
  const employeeById = new Map(Array.from(employeeStats.values()).map((s) => [s.id, s]));

  // Contractor summary
  const contractorStats = new Map<string, { contractor_id: string; assigned_count: number; resolved_count: number; open_count: number }>();
  for (const ct of contractorSeeds) contractorStats.set(ct.id, { contractor_id: ct.id, assigned_count: 0, resolved_count: 0, open_count: 0 });
  for (const c of seededComplaints) {
    const st = contractorStats.get(c.contractorId)!;
    st.assigned_count += 1;
    if (c.status === 'RESOLVED') st.resolved_count += 1;
    if (c.status !== 'RESOLVED') st.open_count += 1;
    contractorStats.set(c.contractorId, st);
  }
  const contractorSummary = Array.from(contractorStats.values()).sort((a, b) => b.assigned_count - a.assigned_count);

  const citizenMetrics = citizens.map((citizen) => {
    const filed = seededComplaints.filter((complaint) => complaint.citizen.id === citizen.id).length;
    const resolved = seededComplaints.filter((complaint) => complaint.citizen.id === citizen.id && complaint.status === 'RESOLVED').length;
    const escalated = seededComplaints.filter((complaint) => complaint.citizen.id === citizen.id && complaint.status === 'ESCALATED').length;
    const karma = 100 + resolved * 7 - escalated * 6 + filed;
    return { citizen: citizen.label, phone: citizen.phone, complaintsFiled: filed, resolved, escalated, seedKarma: karma };
  });

  // eslint-disable-next-line no-console
  console.log(
    `[seed-demo] seeded: complaints=${seededComplaints.length} citizens=${citizens.length} officers=${officers.length} contractorUsers=${contractorUsers.length} contractors=${contractorSeeds.length} districts=${districtSeeds.length}`
  );
  // eslint-disable-next-line no-console
  console.table([
    { account: adminSeed.label, username: adminSeed.username, phone: adminSeed.phone, role: adminSeed.role, districts: adminSeed.districts.join(', '), seedKarma: 200 },
    ...officers.map((officer) => {
      const row = employeeById.get(officer.dbId) as { assigned?: number; resolved?: number; escalated?: number; sla_warnings?: number } | undefined;
      return {
        account: officer.label,
        username: officer.username,
        phone: officer.phone,
        role: officer.role,
        districts: officer.districts.join(', '),
        seedKarma: 140 + Number(row?.resolved ?? 0) * 6 + Number(row?.assigned ?? 0) * 2 - Number(row?.escalated ?? 0) * 4 - Number(row?.sla_warnings ?? 0) * 3
      };
    }),
    ...citizenMetrics.map((item, index) => ({ ...item, username: citizenSeeds[index]?.username ?? '' })),
    ...contractorUsers.map((item) => ({
      account: item.label,
      username: item.username,
      phone: item.phone,
      role: item.role,
      districts: item.districts.join(', '),
      seedKarma: 125
    })),
    ...contractorSummary.map((row) => ({
      account: row.contractor_id,
      phone: contractorSeeds.find((item) => item.id === row.contractor_id)?.contactPhoneMasked ?? '',
      role: 'CONTRACTOR',
      districts: contractorSeeds.find((item) => item.id === row.contractor_id)?.districts.join(', ') ?? '',
      seedKarma: 100 + Number(row.resolved_count ?? 0) * 5 - Number(row.open_count ?? 0)
    }))
  ]);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-demo] failed:', err);
  process.exit(1);
});