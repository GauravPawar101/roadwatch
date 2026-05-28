import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import dotenv from 'dotenv';
import { writeFile } from 'fs/promises';
import path from 'path';
import { KafkaProducer } from '../../../providers/kafka/KafkaProducer.js';
import { KafkaTopics, type ComplaintSubmittedEvent } from '../../../providers/kafka/topics.js';

dotenv.config();
process.env.ROADWATCH_SKIP_MINI_SEED = '1';

let pool: {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number; rows?: Array<Record<string, unknown>> }>;
};

let trackAnalyticsEvent: any;

type SeededUser = SeedUser & { dbId: string };

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

type DistrictBlueprint = Omit<DistrictSeed, 'roads'> & {
  roads: Array<{ name: string; roadType: string; totalLengthKm: number }>;
};

type SeedUser = {
  id: string;
  phone: string;
  maskedPhone: string;
  username: string;
  email?: string | null;
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
  roadName: string;
  authorityId: string;
  authorityName: string;
  contractorId: string;
  citizen: SeededUser;
  officer: SeededUser;
  status: 'FILED' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';
  title: string;
  description: string;
  damageType: string;
  severity: number;
  lat: number;
  lng: number;
  createdAt: Date;
  assignedAt: Date;
  updatedAt: Date;
  expectedResolutionDays: number;
  aiScore: number;
  repaired: boolean;
};

type SeedCredential = {
  role: SeedUser['role'];
  label: string;
  loginTypes: string[];
  identifiers: string[];
};

const seededComplaintTotal = 1000;

function mulberry32(seed: number) {
  return function next() {
    let value = seed += 0x6d2b79f5;
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

function deterministicUuid(seed: string) {
  const hash = createHash('sha256').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
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

function buildDistrictSeed(blueprint: DistrictBlueprint): DistrictSeed {
  return {
    ...blueprint,
    roads: blueprint.roads.map((road, index) => ({
      id: `SEED-RD-${blueprint.districtCode}-${String(index + 1).padStart(2, '0')}`,
      name: road.name,
      roadType: road.roadType,
      totalLengthKm: road.totalLengthKm
    }))
  };
}

const districtBlueprints: DistrictBlueprint[] = [
  {
    stateCode: 'DL',
    stateName: 'Delhi',
    districtName: 'New Delhi',
    districtCode: 'DL-ND',
    authorityId: 'AUTH-DL',
    authorityName: 'Delhi PWD',
    center: { lat: 28.614, lng: 77.209 },
    complaintCount: 20,
    zones: ['Central', 'Lutyens', 'Connaught Place'],
    roads: [
      { name: 'Ring Road', roadType: 'ARTERIAL', totalLengthKm: 48 },
      { name: 'Rajpath Spine', roadType: 'COLLECTOR', totalLengthKm: 7 },
      { name: 'India Gate Loop', roadType: 'LOCAL', totalLengthKm: 5 },
      { name: 'Heritage Connector', roadType: 'ARTERIAL', totalLengthKm: 14 }
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
    complaintCount: 18,
    zones: ['South', 'Okhla', 'Saket'],
    roads: [
      { name: 'Aurobindo Marg', roadType: 'ARTERIAL', totalLengthKm: 17 },
      { name: 'Mehrauli-Badarpur Road', roadType: 'HIGHWAY', totalLengthKm: 23 },
      { name: 'Nelson Mandela Marg', roadType: 'COLLECTOR', totalLengthKm: 10 },
      { name: 'Saket Link', roadType: 'LOCAL', totalLengthKm: 6 }
    ]
  },
  {
    stateCode: 'DL',
    stateName: 'Delhi',
    districtName: 'East Delhi',
    districtCode: 'DL-ED',
    authorityId: 'AUTH-DL',
    authorityName: 'Delhi PWD',
    center: { lat: 28.646, lng: 77.302 },
    complaintCount: 14,
    zones: ['Shahdara', 'Preet Vihar', 'Yamuna Vihar'],
    roads: [
      { name: 'Vikas Marg', roadType: 'ARTERIAL', totalLengthKm: 14 },
      { name: 'Geeta Colony Flyover', roadType: 'EXPRESSWAY', totalLengthKm: 4 },
      { name: 'ITO Relief Road', roadType: 'COLLECTOR', totalLengthKm: 9 }
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
    complaintCount: 18,
    zones: ['West', 'Coastal', 'Island'],
    roads: [
      { name: 'Western Express Highway', roadType: 'HIGHWAY', totalLengthKm: 25 },
      { name: 'Eastern Express Highway', roadType: 'HIGHWAY', totalLengthKm: 22 },
      { name: 'SV Road', roadType: 'ARTERIAL', totalLengthKm: 12 },
      { name: 'Coastal Road', roadType: 'EXPRESSWAY', totalLengthKm: 29 }
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
    complaintCount: 14,
    zones: ['Pune-East', 'Pune-West', 'Hadapsar'],
    roads: [
      { name: 'University Road', roadType: 'COLLECTOR', totalLengthKm: 11 },
      { name: 'Sinhagad Road', roadType: 'ARTERIAL', totalLengthKm: 14 },
      { name: 'Nagar Road', roadType: 'HIGHWAY', totalLengthKm: 17 }
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
    complaintCount: 16,
    zones: ['Trans-Gomti', 'Central', 'Alambagh'],
    roads: [
      { name: 'Gomti Nagar Link Road', roadType: 'ARTERIAL', totalLengthKm: 13 },
      { name: 'Sitapur Road', roadType: 'ARTERIAL', totalLengthKm: 19 },
      { name: 'Airport Corridor', roadType: 'EXPRESSWAY', totalLengthKm: 16 },
      { name: 'Charbagh Spur', roadType: 'COLLECTOR', totalLengthKm: 8 }
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
    complaintCount: 14,
    zones: ['Sector-18', 'Greater Noida', 'Expressway'],
    roads: [
      { name: 'Noida Expressway', roadType: 'HIGHWAY', totalLengthKm: 25 },
      { name: 'Dadri Main Road', roadType: 'COLLECTOR', totalLengthKm: 8 },
      { name: 'Sector-62 Connector', roadType: 'LOCAL', totalLengthKm: 6 }
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
    complaintCount: 14,
    zones: ['Central', 'East', 'South'],
    roads: [
      { name: 'Outer Ring Road', roadType: 'ARTERIAL', totalLengthKm: 62 },
      { name: 'Airport Road', roadType: 'ARTERIAL', totalLengthKm: 16 },
      { name: 'Hosur Road', roadType: 'HIGHWAY', totalLengthKm: 29 },
      { name: 'Tumakuru Main Road', roadType: 'COLLECTOR', totalLengthKm: 18 }
    ]
  },
  {
    stateCode: 'KA',
    stateName: 'Karnataka',
    districtName: 'Mysuru',
    districtCode: 'KA-MYS',
    authorityId: 'AUTH-KA',
    authorityName: 'Karnataka PWD',
    center: { lat: 12.2958, lng: 76.6394 },
    complaintCount: 10,
    zones: ['Palace', 'Outer Ring', 'South'],
    roads: [
      { name: 'Outer Ring Boulevard', roadType: 'ARTERIAL', totalLengthKm: 24 },
      { name: 'Hunsur Road', roadType: 'COLLECTOR', totalLengthKm: 11 },
      { name: 'Bannur Road', roadType: 'LOCAL', totalLengthKm: 9 }
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
    complaintCount: 12,
    zones: ['North', 'South', 'Marina'],
    roads: [
      { name: 'Anna Salai', roadType: 'ARTERIAL', totalLengthKm: 11 },
      { name: 'OMR', roadType: 'HIGHWAY', totalLengthKm: 45 },
      { name: 'Poonamallee High Road', roadType: 'ARTERIAL', totalLengthKm: 17 },
      { name: 'GST Road', roadType: 'HIGHWAY', totalLengthKm: 33 }
    ]
  },
  {
    stateCode: 'TS',
    stateName: 'Telangana',
    districtName: 'Hyderabad',
    districtCode: 'TS-HYD',
    authorityId: 'AUTH-TS',
    authorityName: 'Telangana PWD',
    center: { lat: 17.385, lng: 78.4867 },
    complaintCount: 12,
    zones: ['Hitech City', 'Old City', 'Secunderabad'],
    roads: [
      { name: 'Hitech City Road', roadType: 'ARTERIAL', totalLengthKm: 13 },
      { name: 'Outer Ring Road', roadType: 'EXPRESSWAY', totalLengthKm: 158 },
      { name: 'Tank Bund Road', roadType: 'COLLECTOR', totalLengthKm: 8 }
    ]
  },
  {
    stateCode: 'GJ',
    stateName: 'Gujarat',
    districtName: 'Ahmedabad',
    districtCode: 'GJ-AHM',
    authorityId: 'AUTH-GJ',
    authorityName: 'Gujarat PWD',
    center: { lat: 23.0225, lng: 72.5714 },
    complaintCount: 10,
    zones: ['West', 'East', 'Navrangpura'],
    roads: [
      { name: 'SG Highway', roadType: 'HIGHWAY', totalLengthKm: 42 },
      { name: 'Ashram Road', roadType: 'ARTERIAL', totalLengthKm: 12 },
      { name: 'CG Road', roadType: 'COLLECTOR', totalLengthKm: 7 }
    ]
  },
  {
    stateCode: 'WB',
    stateName: 'West Bengal',
    districtName: 'Kolkata',
    districtCode: 'WB-KOL',
    authorityId: 'AUTH-WB',
    authorityName: 'West Bengal PWD',
    center: { lat: 22.5726, lng: 88.3639 },
    complaintCount: 10,
    zones: ['North', 'South', 'Park Street'],
    roads: [
      { name: 'EM Bypass', roadType: 'HIGHWAY', totalLengthKm: 27 },
      { name: 'AJC Bose Road', roadType: 'ARTERIAL', totalLengthKm: 9 },
      { name: 'Diamond Harbour Road', roadType: 'COLLECTOR', totalLengthKm: 16 }
    ]
  },
  {
    stateCode: 'KL',
    stateName: 'Kerala',
    districtName: 'Thiruvananthapuram',
    districtCode: 'KL-TVM',
    authorityId: 'AUTH-KL',
    authorityName: 'Kerala PWD',
    center: { lat: 8.5241, lng: 76.9366 },
    complaintCount: 8,
    zones: ['Central', 'Coastal', 'Kowdiar'],
    roads: [
      { name: 'Kowdiar Road', roadType: 'COLLECTOR', totalLengthKm: 6 },
      { name: 'NH66', roadType: 'HIGHWAY', totalLengthKm: 25 },
      { name: 'MG Road', roadType: 'ARTERIAL', totalLengthKm: 8 }
    ]
  }
];

const districtSeeds: DistrictSeed[] = districtBlueprints.map(buildDistrictSeed);

const adminSeed: SeedUser = {
  id: 'SEED-ADMIN-01',
  phone: phoneFromIndex('990000', 1),
  maskedPhone: '+91-99XXXX0001',
  username: 'admin.ce',
  email: 'admin.ce@roadwatch.local',
  role: 'CE',
  districts: ['ALL'],
  zones: ['ALL'],
  govtId: 'ADM-001',
  label: 'Admin / CE'
};

const officerDistrictSets = [
  ['New Delhi', 'South Delhi'],
  ['East Delhi'],
  ['Mumbai'],
  ['Pune', 'Mumbai'],
  ['Lucknow', 'Noida'],
  ['Bengaluru Urban'],
  ['Mysuru', 'Bengaluru Urban'],
  ['Chennai'],
  ['Hyderabad'],
  ['Ahmedabad'],
  ['Kolkata'],
  ['Thiruvananthapuram'],
  ['New Delhi', 'East Delhi'],
  ['South Delhi', 'Ahmedabad']
];

const officerSeeds: SeedUser[] = officerDistrictSets.map((districts, index) => ({
  id: `SEED-OFFICER-${String(index + 1).padStart(2, '0')}`,
  phone: phoneFromIndex('991000', index + 1),
  maskedPhone: `+91-99XXXX${String(index + 1).padStart(4, '0')}`,
  username: `ee.${slugify(districts.join('-'))}.${String(index + 1).padStart(2, '0')}`,
  email: index % 2 === 0 ? `ee.${slugify(districts.join('-'))}@roadwatch.local` : null,
  role: 'EE',
  districts,
  zones: ['ALL'],
  govtId: `OFF-${String(index + 1).padStart(3, '0')}`,
  label: `District Officer ${index + 1}`
}));

const citizenSeeds: SeedUser[] = districtSeeds.flatMap((district, districtIndex) =>
  Array.from({ length: 4 }, (_unused, localIndex) => {
    const numericIndex = districtIndex * 4 + localIndex + 1;
    const username = `citizen.${slugify(district.districtName)}.${String(localIndex + 1).padStart(2, '0')}`;
    return {
      id: `SEED-CITIZEN-${String(numericIndex).padStart(3, '0')}`,
      phone: phoneFromIndex('992000', numericIndex),
      maskedPhone: `+91-98XXXX${String(numericIndex).padStart(4, '0')}`,
      username,
      email: localIndex % 2 === 0 ? `${username}@roadwatch.local` : null,
      role: 'CITIZEN',
      districts: [district.districtName],
      zones: [district.zones[localIndex % district.zones.length]!],
      govtId: `CIT-${String(numericIndex).padStart(4, '0')}`,
      label: `Citizen ${numericIndex} (${district.districtName})`
    };
  })
);

const contractorNames = [
  'SuperBuild Infra',
  'Delta Roads Pvt Ltd',
  'Northline Infrastructure',
  'Gomti Civil Works',
  'Yamuna Buildcon',
  'Metro Grid Works',
  'Coromandel Roads',
  'UrbanLift Infra',
  'Peakline Projects',
  'Delta East Maintenance',
  'Harbor Arc Contractors',
  'Crescent Surface Systems',
  'Vertex Pavement Works',
  'Monsoon Civil Group',
  'Pinnacle Highway Services'
];

const contractorSeeds: SeedContractor[] = districtSeeds.map((district, index) => {
  const partnerDistrict = districtSeeds[(index + 1) % districtSeeds.length]!;
  return {
    id: deterministicUuid(`contractor:${index + 1}`),
    name: contractorNames[index % contractorNames.length]!,
    registrationNumber: `CTR-${String(index + 1).padStart(4, '0')}`,
    contactPhoneMasked: `+91-98XXXX${String(2001 + index).padStart(4, '0')}`,
    districts: [district.districtName, partnerDistrict.districtName],
    zones: [district.zones[0]!, partnerDistrict.zones[0]!]
  };
});

const contractorUserSeeds: SeedUser[] = contractorSeeds.map((contractor, index) => ({
  id: `SEED-CTR-USER-${String(index + 1).padStart(2, '0')}`,
  phone: phoneFromIndex('993000', index + 1),
  maskedPhone: `+91-97XXXX${String(index + 1).padStart(4, '0')}`,
  username: slugify(contractor.name),
  email: `${slugify(contractor.name)}@roadwatch.local`,
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
    'loose gravel patch',
    'lane marking fade',
    'utility cut settlement'
  ];
  return `${patterns[index % patterns.length]} reported on ${roadName} in ${district}`;
}

function complaintCountSummary() {
  return seededComplaintTotal;
}

async function setPasswordForUser(userId: string, password: string) {
  const hash = await bcrypt.hash(password, 10);
  const existing = await pool.query(
    `SELECT metadata FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

  const metadataRow = existing.rows?.[0] as Record<string, unknown> | undefined;
  const metadata: Record<string, unknown> = (metadataRow?.metadata as Record<string, unknown>) ?? {};
  metadata.password_hash = hash;
  metadata.signup_method = 'username';

  await pool.query(
    `UPDATE users
     SET password_hash = $1,
         signup_method = $2,
         metadata = $3,
         updated_at = $4
     WHERE id = $5`,
    [hash, 'username', metadata, new Date(), userId]
  );
}

async function writeCredentialFile(password: string, accounts: SeedUser[]) {
  const districtStateMap = new Map(districtSeeds.map((district) => [district.districtName, district.stateName]));

  const credentialRows = accounts.map((user) => {
    const coverage = user.districts.includes('ALL')
      ? 'All states / cities'
      : [...new Set(user.districts.map((district) => `${districtStateMap.get(district) ?? 'Unknown'} / ${district}`))].join(' | ');
    const loginTypes = ['username', user.email ? 'email' : null, 'phone'].filter(Boolean) as string[];
    const identifiers = [user.username, user.email ?? '', user.phone].filter(Boolean).join(' · ');

    return {
      role: user.role,
      label: user.label,
      coverage,
      loginTypes: loginTypes.join(', '),
      identifiers
    } satisfies SeedCredential & { coverage: string };
  });

  const lines: string[] = [];
  lines.push('# RoadWatch Seed Credentials');
  lines.push('');
  lines.push(`Default password for every seeded demo account: ${password}`);
  lines.push('');
  lines.push('| Role | Account | State / City coverage | Login types | Identifiers | Password |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of credentialRows) {
    lines.push(`| ${row.role} | ${row.label} | ${row.coverage} | ${row.loginTypes} | ${row.identifiers} | ${password} |`);
  }
  lines.push('');
  lines.push('Seeded login patterns:');
  lines.push('- Officers use `ee.*` usernames and some also have `@roadwatch.local` email aliases.');
  lines.push('- Citizens use `citizen.*` usernames; half also have email aliases.');
  lines.push('- Contractors use slugged company usernames and email aliases.');

  const repoRoot = path.resolve(process.cwd(), '../../');
  await writeFile(path.join(repoRoot, 'credentials.txt'), lines.join('\n'), 'utf8');
  await writeFile(path.join(repoRoot, 'TEST_CREDENTIALS.md'), lines.join('\n'), 'utf8');
}

async function cleanupSeedRows(complaintIds: string[], roadIds: string[], contractorIds: string[]) {
  if (complaintIds.length > 0) {
    await pool.query(`DELETE FROM complaint_assignments WHERE complaint_id = ANY($1)`, [complaintIds]).catch(() => null);
    await pool.query(`DELETE FROM complaint_attachments WHERE complaint_id = ANY($1)`, [complaintIds]).catch(() => null);
    await pool.query(`DELETE FROM authority_action_logs WHERE complaint_id = ANY($1)`, [complaintIds]).catch(() => null);
    await pool.query(`DELETE FROM complaint_merkle_proofs WHERE complaint_id = ANY($1)`, [complaintIds]).catch(() => null);
    await pool.query(`DELETE FROM complaint_merkle_proofs_by_batch WHERE complaint_id = ANY($1)`, [complaintIds]).catch(() => null);
    await pool.query(`DELETE FROM sla_tracking WHERE complaint_id = ANY($1)`, [complaintIds]).catch(() => null);
    await pool.query(`DELETE FROM complaints WHERE id = ANY($1)`, [complaintIds]).catch(() => null);
  }

  if (roadIds.length > 0) {
    await pool.query(`DELETE FROM road_assignments WHERE road_id = ANY($1)`, [roadIds]).catch(() => null);
    await pool.query(`DELETE FROM roads_catalog WHERE id = ANY($1)`, [roadIds]).catch(() => null);
  }

  if (contractorIds.length > 0) {
    await pool.query(`DELETE FROM contractors WHERE id = ANY($1)`, [contractorIds]).catch(() => null);
  }
}

async function seedComplaintRecord(params: {
  complaint: SeedComplaint;
  user: SeededUser;
  officer: SeededUser;
  contractor: SeedContractor;
  officerPhoneHash: string;
}) {
  const { complaint, user, officer, contractor, officerPhoneHash } = params;
  const createdAtIso = complaint.createdAt.toISOString();
  const updatedAtIso = complaint.updatedAt.toISOString();
  const complaintMetadata = {
    district: complaint.district,
    zone: complaint.zone,
    description: complaint.description,
    damageType: complaint.damageType,
    severity: complaint.severity,
    lat: complaint.lat,
    lng: complaint.lng,
    road_id: complaint.roadId,
    authority_id: complaint.authorityId,
    created_at: createdAtIso,
    updated_at: updatedAtIso,
    fabric_txid: `SEED-TX-${complaint.id}`,
    reporter: { userId: user.dbId, role: user.role },
    assignedTo: { userId: officer.dbId, role: officer.role, contractorId: contractor.id }
  };

  await pool.query(
    `INSERT INTO complaints (
      id, road_id, district, zone, status, title, damage_type, severity, description,
      metadata, details_hash, lat, lng, authority_id, authority_org, report_count,
      event_status, anchored_tx_hash, anchored_at, last_authority_action, fabric_txid,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10::jsonb, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21,
      $22, $23
    )
    ON CONFLICT (id) DO UPDATE SET
      road_id = EXCLUDED.road_id,
      district = EXCLUDED.district,
      zone = EXCLUDED.zone,
      status = EXCLUDED.status,
      title = EXCLUDED.title,
      damage_type = EXCLUDED.damage_type,
      severity = EXCLUDED.severity,
      description = EXCLUDED.description,
      metadata = EXCLUDED.metadata,
      details_hash = EXCLUDED.details_hash,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      authority_id = EXCLUDED.authority_id,
      authority_org = EXCLUDED.authority_org,
      report_count = EXCLUDED.report_count,
      event_status = EXCLUDED.event_status,
      anchored_tx_hash = EXCLUDED.anchored_tx_hash,
      anchored_at = EXCLUDED.anchored_at,
      last_authority_action = EXCLUDED.last_authority_action,
      fabric_txid = EXCLUDED.fabric_txid,
      updated_at = EXCLUDED.updated_at`,
    [
      complaint.id,
      complaint.roadId,
      complaint.district,
      complaint.zone,
      complaint.status,
      complaint.title,
      complaint.damageType,
      complaint.severity,
      complaint.description,
      JSON.stringify(complaintMetadata),
      createHash('sha256').update(JSON.stringify(complaintMetadata)).digest('hex'),
      complaint.lat,
      complaint.lng,
      complaint.authorityId,
      complaint.authorityName,
      1,
      'ASSIGNED',
      `SEED-TX-${complaint.id}`,
      complaint.assignedAt,
      `SEED-TX-${complaint.id}`,
      'ASSIGNED',
      complaint.createdAt,
      complaint.updatedAt
    ]
  );

  await pool.query(
    `INSERT INTO complaint_assignments (
      complaint_id, district, contractor_id, inspector_id, assigned_at,
      expected_resolution_days, assigned_by_user_id, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (complaint_id) DO UPDATE SET
      district = EXCLUDED.district,
      contractor_id = EXCLUDED.contractor_id,
      inspector_id = EXCLUDED.inspector_id,
      assigned_at = EXCLUDED.assigned_at,
      expected_resolution_days = EXCLUDED.expected_resolution_days,
      assigned_by_user_id = EXCLUDED.assigned_by_user_id,
      notes = EXCLUDED.notes`,
    [
      complaint.id,
      complaint.district,
      contractor.id,
      officer.dbId,
      complaint.assignedAt,
      complaint.expectedResolutionDays,
      officer.dbId,
      `seeded assignment for ${complaint.id}`
    ]
  );

  const attachmentBase = `complaints/${slugify(complaint.district)}/${complaint.id}`;
  const attachments = [
    { kind: 'PHOTO', file_path: `${attachmentBase}/before.jpg`, file_mime: 'image/jpeg', note: { stage: 'before', seeded: true } },
    { kind: 'PHOTO', file_path: `${attachmentBase}/after.jpg`, file_mime: 'image/jpeg', note: { stage: 'after', seeded: true } }
  ];
  for (const [index, attachment] of attachments.entries()) {
    const attachmentId = deterministicUuid(`complaint-attachment:${complaint.id}:${index}`);
    await pool.query(
      `INSERT INTO complaint_attachments (id, complaint_id, kind, file_path, file_mime, file_sha256, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (id) DO UPDATE SET
         complaint_id = EXCLUDED.complaint_id,
         kind = EXCLUDED.kind,
         file_path = EXCLUDED.file_path,
         file_mime = EXCLUDED.file_mime,
         file_sha256 = EXCLUDED.file_sha256,
         note = EXCLUDED.note,
         created_at = EXCLUDED.created_at`,
      [
        attachmentId,
        complaint.id,
        attachment.kind,
        attachment.file_path,
        attachment.file_mime,
        createHash('sha256').update(`${complaint.id}:${index}:${attachment.file_path}`).digest('hex'),
        JSON.stringify(attachment.note),
        complaint.createdAt
      ]
    );
  }

  const auditEvents: Array<{ action: string; actorId: string; details: Record<string, unknown> }> = [
    { action: 'COMPLAINT_CREATED', actorId: user.dbId, details: { status: complaint.status, roadId: complaint.roadId, seeded: true } },
    { action: 'COMPLAINT_ASSIGNED', actorId: officer.dbId, details: { contractorId: contractor.id, expectedResolutionDays: complaint.expectedResolutionDays } }
  ];
  if (complaint.status === 'RESOLVED') {
    auditEvents.push({ action: 'COMPLAINT_RESOLVED', actorId: officer.dbId, details: { repaired: complaint.repaired, seeded: true } });
  } else if (complaint.status === 'ESCALATED') {
    auditEvents.push({ action: 'COMPLAINT_ESCALATED', actorId: officer.dbId, details: { severity: complaint.severity, seeded: true } });
  }

  for (const [index, audit] of auditEvents.entries()) {
    const auditId = deterministicUuid(`audit:${complaint.id}:${audit.action}:${index}`);
    await pool.query(
      `INSERT INTO audit_log (
        id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      ON CONFLICT (id) DO UPDATE SET
        actor_user_id = EXCLUDED.actor_user_id,
        actor_phone_hash = EXCLUDED.actor_phone_hash,
        actor_phone_masked = EXCLUDED.actor_phone_masked,
        action = EXCLUDED.action,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        details = EXCLUDED.details,
        created_at = EXCLUDED.created_at`,
      [
        auditId,
        audit.actorId,
        officerPhoneHash,
        officer.maskedPhone,
        audit.action,
        'COMPLAINT',
        complaint.id,
        JSON.stringify(audit.details),
        complaint.updatedAt
      ]
    );
  }

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
    properties: { roadId: complaint.roadId, severity: complaint.severity, seeded: true }
  });
  await trackAnalyticsEvent({
    type: 'COMPLAINT_ASSIGNED',
    actorUserId: officer.dbId,
    complaintId: complaint.id,
    contractorId: contractor.id,
    district: complaint.district,
    zone: complaint.zone,
    occurredAt: complaint.assignedAt,
    properties: { expectedResolutionDays: complaint.expectedResolutionDays, seeded: true }
  });
  if (complaint.status === 'RESOLVED' || complaint.status === 'ESCALATED') {
    await trackAnalyticsEvent({
      type: complaint.status === 'RESOLVED' ? 'COMPLAINT_RESOLVED' : 'COMPLAINT_ESCALATED',
      actorUserId: officer.dbId,
      complaintId: complaint.id,
      contractorId: contractor.id,
      district: complaint.district,
      zone: complaint.zone,
      occurredAt: complaint.updatedAt,
      properties: { seeded: true, repaired: complaint.repaired }
    });
  }
  if (complaint.status === 'IN_PROGRESS' && complaint.expectedResolutionDays >= 10) {
    const warningAt = new Date(complaint.updatedAt.getTime() + 24 * 60 * 60 * 1000);
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

  await pool.query(
    `INSERT INTO authority_action_logs (id, complaint_id, authority_id, action_type, action_data, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (id) DO UPDATE SET
       complaint_id = EXCLUDED.complaint_id,
       authority_id = EXCLUDED.authority_id,
       action_type = EXCLUDED.action_type,
       action_data = EXCLUDED.action_data,
       created_at = EXCLUDED.created_at`,
    [
      deterministicUuid(`authority:${complaint.id}:assigned`),
      complaint.id,
      complaint.authorityId,
      'COMPLAINT_ASSIGNED',
      JSON.stringify({ contractorId: contractor.id, expectedResolutionDays: complaint.expectedResolutionDays, assignedBy: officer.dbId }),
      complaint.assignedAt
    ]
  );

  const statusAction = complaint.status === 'RESOLVED' ? 'COMPLAINT_RESOLVED' : complaint.status === 'ESCALATED' ? 'COMPLAINT_ESCALATED' : null;
  if (statusAction) {
    await pool.query(
      `INSERT INTO authority_action_logs (id, complaint_id, authority_id, action_type, action_data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (id) DO UPDATE SET
         complaint_id = EXCLUDED.complaint_id,
         authority_id = EXCLUDED.authority_id,
         action_type = EXCLUDED.action_type,
         action_data = EXCLUDED.action_data,
         created_at = EXCLUDED.created_at`,
      [
        deterministicUuid(`authority:${complaint.id}:${statusAction}`),
        complaint.id,
        complaint.authorityId,
        statusAction,
        JSON.stringify({ contractorId: contractor.id, repaired: complaint.repaired }),
        complaint.updatedAt
      ]
    );
  }

  await pool.query(
    `INSERT INTO complaint_merkle_proofs (complaint_id, merkle_root, merkle_proof, fabric_txid, batch_id, anchored_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (complaint_id) DO UPDATE SET
       merkle_root = EXCLUDED.merkle_root,
       merkle_proof = EXCLUDED.merkle_proof,
       fabric_txid = EXCLUDED.fabric_txid,
       batch_id = EXCLUDED.batch_id,
       anchored_at = EXCLUDED.anchored_at`,
    [
      complaint.id,
      `ROOT-${slugify(complaint.district)}-${slugify(complaint.roadName)}`,
      JSON.stringify([{ path: complaint.id, side: 'left' }, { path: complaint.roadId, side: 'right' }]),
      `SEED-TX-${complaint.id}`,
      `BATCH-${slugify(complaint.district)}`,
      complaint.updatedAt
    ]
  );

  await pool.query(
    `INSERT INTO complaint_merkle_proofs_by_batch (batch_id, complaint_id, merkle_root, merkle_proof, fabric_txid, anchored_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (batch_id, complaint_id) DO UPDATE SET
       merkle_root = EXCLUDED.merkle_root,
       merkle_proof = EXCLUDED.merkle_proof,
       fabric_txid = EXCLUDED.fabric_txid,
       anchored_at = EXCLUDED.anchored_at`,
    [
      `BATCH-${slugify(complaint.district)}`,
      complaint.id,
      `ROOT-${slugify(complaint.district)}-${slugify(complaint.roadName)}`,
      JSON.stringify([{ path: complaint.id, side: 'left' }, { path: complaint.roadId, side: 'right' }]),
      `SEED-TX-${complaint.id}`,
      complaint.updatedAt
    ]
  );

  await pool.query(
    `INSERT INTO sla_tracking (complaint_id, contractor_id, breached, breach_notified, sla_deadline, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (complaint_id) DO UPDATE SET
       contractor_id = EXCLUDED.contractor_id,
       breached = EXCLUDED.breached,
       breach_notified = EXCLUDED.breach_notified,
       sla_deadline = EXCLUDED.sla_deadline,
       updated_at = EXCLUDED.updated_at`,
    [
      complaint.id,
      contractor.id,
      complaint.status === 'ESCALATED',
      complaint.status === 'ESCALATED' || complaint.status === 'IN_PROGRESS',
      complaint.assignedAt,
      complaint.updatedAt
    ]
  );

  await pool.query(
    `INSERT INTO complaint_event_outbox (id, topic, message_key, payload, status, attempts, last_error, available_at, created_at, updated_at, sent_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       topic = EXCLUDED.topic,
       message_key = EXCLUDED.message_key,
       payload = EXCLUDED.payload,
       status = EXCLUDED.status,
       attempts = EXCLUDED.attempts,
       last_error = EXCLUDED.last_error,
       available_at = EXCLUDED.available_at,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at,
       sent_at = EXCLUDED.sent_at`,
    [
      deterministicUuid(`outbox:${complaint.id}`),
      'complaints.events',
      complaint.id,
      JSON.stringify({ complaintId: complaint.id, district: complaint.district, status: complaint.status, seeded: true }),
      'PENDING',
      0,
      null,
      complaint.createdAt,
      complaint.createdAt,
      complaint.updatedAt,
      null
    ]
  );

  await pool.query(
    `INSERT INTO access_logs (id, user_id, resource_type, resource_id, action, accessed_fields, ip_address, user_agent, status, reason_blocked, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       resource_type = EXCLUDED.resource_type,
       resource_id = EXCLUDED.resource_id,
       action = EXCLUDED.action,
       accessed_fields = EXCLUDED.accessed_fields,
       ip_address = EXCLUDED.ip_address,
       user_agent = EXCLUDED.user_agent,
       status = EXCLUDED.status,
       reason_blocked = EXCLUDED.reason_blocked,
       created_at = EXCLUDED.created_at`,
    [
      deterministicUuid(`access:${complaint.id}`),
      user.dbId,
      'complaint',
      complaint.id,
      'VIEW',
      ['status', 'description', 'zone'],
      '127.0.0.1',
      'RoadWatch/seed',
      'ALLOWED',
      null,
      complaint.createdAt
    ]
  );

  await pool.query(
    `INSERT INTO image_submissions (
      id, request_id, uploader_id_encrypted, uploader_pseudonym, server_received_at,
      exif_timestamp, exif_latitude, exif_longitude, device_latitude, device_longitude,
      nonce, phash, verified_status, storage_path, metadata, created_by_id, created_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15::jsonb, $16, $17
    )
    ON CONFLICT (id) DO UPDATE SET
      request_id = EXCLUDED.request_id,
      uploader_id_encrypted = EXCLUDED.uploader_id_encrypted,
      uploader_pseudonym = EXCLUDED.uploader_pseudonym,
      server_received_at = EXCLUDED.server_received_at,
      exif_timestamp = EXCLUDED.exif_timestamp,
      exif_latitude = EXCLUDED.exif_latitude,
      exif_longitude = EXCLUDED.exif_longitude,
      device_latitude = EXCLUDED.device_latitude,
      device_longitude = EXCLUDED.device_longitude,
      nonce = EXCLUDED.nonce,
      phash = EXCLUDED.phash,
      verified_status = EXCLUDED.verified_status,
      storage_path = EXCLUDED.storage_path,
      metadata = EXCLUDED.metadata,
      created_by_id = EXCLUDED.created_by_id,
      created_at = EXCLUDED.created_at`,
    [
      deterministicUuid(`image:${complaint.id}`),
      complaint.id,
      `enc:${user.dbId}`,
      `pseudonym-${slugify(complaint.district)}-${complaint.id.slice(-4)}`,
      complaint.createdAt,
      complaint.createdAt,
      complaint.lat,
      complaint.lng,
      complaint.lat,
      complaint.lng,
      `nonce-${complaint.id}`,
      `BATCH-${slugify(complaint.district)}`,
      complaint.status === 'RESOLVED' ? 'VERIFIED' : 'REVIEWED',
      `storage/complaints/${complaint.id}/proof.jpg`,
      JSON.stringify({ complaintId: complaint.id, seeded: true, district: complaint.district }),
      user.dbId,
      complaint.updatedAt
    ]
  );

  const submissionId = deterministicUuid(`image:${complaint.id}`);
  await pool.query(
    `INSERT INTO verification_audits (id, submission_id, check_type, check_result, detail, reviewer_id, action, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       submission_id = EXCLUDED.submission_id,
       check_type = EXCLUDED.check_type,
       check_result = EXCLUDED.check_result,
       detail = EXCLUDED.detail,
       reviewer_id = EXCLUDED.reviewer_id,
       action = EXCLUDED.action,
       reason = EXCLUDED.reason,
       created_at = EXCLUDED.created_at`,
    [
      deterministicUuid(`verification:${complaint.id}`),
      submissionId,
      'IMAGE_MATCH',
      complaint.status === 'RESOLVED' ? 'PASS' : 'WARN',
      `seeded verification for ${complaint.id}`,
      officer.dbId,
      complaint.status === 'RESOLVED' ? 'APPROVE' : 'REVIEW',
      complaint.status === 'RESOLVED' ? 'Repaired and verified' : 'Repair pending',
      complaint.updatedAt
    ]
  );

  await pool.query(
    `INSERT INTO media (upload_id, object_key, sha256, metadata, hf_result, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (upload_id) DO UPDATE SET
       object_key = EXCLUDED.object_key,
       sha256 = EXCLUDED.sha256,
       metadata = EXCLUDED.metadata,
       hf_result = EXCLUDED.hf_result,
       created_at = EXCLUDED.created_at`,
    [
      `MEDIA-${complaint.id}`,
      `objects/${complaint.id}/road-before-after.jpg`,
      createHash('sha256').update(complaint.id).digest('hex'),
      JSON.stringify({ complaintId: complaint.id, district: complaint.district, seeded: true }),
      JSON.stringify({ status: complaint.status, aiScore: complaint.aiScore }),
      complaint.createdAt
    ]
  );
}

async function seedNotificationBundle(params: {
  notificationId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  district: string | null;
  zone: string | null;
  roadId: string | null;
  recipientRole: SeedUser['role'] | null;
  recipientUsers: SeededUser[];
  createdAt: Date;
  critical?: boolean;
}) {
  const { notificationId, recipientUsers } = params;

  await pool.query(
    `INSERT INTO notifications (id, user_id, recipient_role, type, title, body, data, district, zone, road_id, critical, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       recipient_role = EXCLUDED.recipient_role,
       type = EXCLUDED.type,
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       data = EXCLUDED.data,
       district = EXCLUDED.district,
       zone = EXCLUDED.zone,
       road_id = EXCLUDED.road_id,
       critical = EXCLUDED.critical,
       created_at = EXCLUDED.created_at`,
    [
      notificationId,
      null,
      params.recipientRole,
      params.type,
      params.title,
      params.body,
      JSON.stringify(params.data),
      params.district,
      params.zone,
      params.roadId,
      Boolean(params.critical),
      params.createdAt
    ]
  );

  for (const recipient of recipientUsers) {
    const inboxId = deterministicUuid(`inbox:${notificationId}:${recipient.dbId}`);
    await pool.query(
      `INSERT INTO notification_inbox (id, user_id, notification_id, read_at, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         notification_id = EXCLUDED.notification_id,
         read_at = EXCLUDED.read_at,
         created_at = EXCLUDED.created_at`,
      [
        inboxId,
        recipient.dbId,
        notificationId,
        recipient.role === 'CONTRACTOR' ? params.createdAt : null,
        params.createdAt
      ]
    );

    const channels = recipient.role === 'CITIZEN' ? ['IN_APP', 'SMS'] : ['IN_APP', 'FCM', 'WHATSAPP'];
    for (const channel of channels) {
      const deliveryId = deterministicUuid(`delivery:${notificationId}:${recipient.dbId}:${channel}`);
      await pool.query(
        `INSERT INTO notification_deliveries (id, user_id, notification_id, channel, scheduled_for, batch_key, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           notification_id = EXCLUDED.notification_id,
           channel = EXCLUDED.channel,
           scheduled_for = EXCLUDED.scheduled_for,
           batch_key = EXCLUDED.batch_key,
           status = EXCLUDED.status,
           created_at = EXCLUDED.created_at`,
        [
          deliveryId,
          recipient.dbId,
          notificationId,
          channel,
          params.createdAt,
          `seed-${slugify(params.type)}-${recipient.dbId}`,
          'SENT',
          params.createdAt
        ]
      );

      const deliveryLogId = deterministicUuid(`delivery-log:${notificationId}:${recipient.dbId}:${channel}`);
      await pool.query(
        `INSERT INTO notification_delivery_logs (id, notification_id, channel, status, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           notification_id = EXCLUDED.notification_id,
           channel = EXCLUDED.channel,
           status = EXCLUDED.status,
           created_at = EXCLUDED.created_at`,
        [deliveryLogId, notificationId, channel, 'SENT', params.createdAt]
      );
    }
  }
}

async function seedRtiBundle(params: {
  complaint: SeedComplaint;
  citizen: SeededUser;
  officer: SeededUser;
}) {
  const rtiId = `RTI-${params.complaint.id}`;
  const trackingToken = deterministicUuid(`rti-tracking:${params.complaint.id}`);
  const publicShareToken = deterministicUuid(`rti-share:${params.complaint.id}`);
  const submittedAt = params.complaint.createdAt;
  const responseDueAt = new Date(submittedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const firstAppealLastDate = new Date(responseDueAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const secondAppealLastDate = new Date(firstAppealLastDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO rti_requests (
      id, complaint_id, country_code, authority_name, subject, request_text, status,
      submitted_at, response_due_at, first_appeal_last_date, second_appeal_last_date,
      tracking_token, public_share_token, public_opt_in_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14, $15, $16
    )
    ON CONFLICT (id) DO UPDATE SET
      complaint_id = EXCLUDED.complaint_id,
      country_code = EXCLUDED.country_code,
      authority_name = EXCLUDED.authority_name,
      subject = EXCLUDED.subject,
      request_text = EXCLUDED.request_text,
      status = EXCLUDED.status,
      submitted_at = EXCLUDED.submitted_at,
      response_due_at = EXCLUDED.response_due_at,
      first_appeal_last_date = EXCLUDED.first_appeal_last_date,
      second_appeal_last_date = EXCLUDED.second_appeal_last_date,
      tracking_token = EXCLUDED.tracking_token,
      public_share_token = EXCLUDED.public_share_token,
      public_opt_in_at = EXCLUDED.public_opt_in_at,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at`,
    [
      rtiId,
      params.complaint.id,
      'IN',
      params.complaint.authorityName,
      `Request for road condition evidence on ${params.complaint.roadName}`,
      `Please provide records, repair plans, and contractor details for complaint ${params.complaint.id}.`,
      params.complaint.status === 'FILED' ? 'DRAFT' : 'FILED',
      submittedAt,
      responseDueAt,
      firstAppealLastDate,
      secondAppealLastDate,
      trackingToken,
      publicShareToken,
      params.complaint.status === 'ESCALATED' ? params.complaint.updatedAt : null,
      submittedAt,
      params.complaint.updatedAt
    ]
  );

  const eventTypes = params.complaint.status === 'ESCALATED'
    ? ['RTI_FILED', 'RTI_ESCALATED', 'RTI_DRAFT_UPDATED']
    : ['RTI_FILED', 'RTI_DRAFT_UPDATED'];

  for (const [index, type] of eventTypes.entries()) {
    await pool.query(
      `INSERT INTO rti_events (id, rti_id, type, properties, occurred_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO UPDATE SET
         rti_id = EXCLUDED.rti_id,
         type = EXCLUDED.type,
         properties = EXCLUDED.properties,
         occurred_at = EXCLUDED.occurred_at`,
      [
        deterministicUuid(`rti-event:${rtiId}:${type}:${index}`),
        rtiId,
        type,
        JSON.stringify({ seeded: true, complaintId: params.complaint.id, officerId: params.officer.dbId }),
        new Date(submittedAt.getTime() + index * 60 * 60 * 1000)
      ]
    );
  }

  if (params.complaint.status !== 'FILED') {
    await pool.query(
      `INSERT INTO rti_responses (id, rti_id, file_path, file_mime, file_sha256, notes, received_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         rti_id = EXCLUDED.rti_id,
         file_path = EXCLUDED.file_path,
         file_mime = EXCLUDED.file_mime,
         file_sha256 = EXCLUDED.file_sha256,
         notes = EXCLUDED.notes,
         received_at = EXCLUDED.received_at,
         created_at = EXCLUDED.created_at`,
      [
        deterministicUuid(`rti-response:${rtiId}`),
        rtiId,
        `responses/${rtiId}.pdf`,
        'application/pdf',
        createHash('sha256').update(rtiId).digest('hex'),
        'Seeded RTI response package',
        new Date(responseDueAt.getTime() - 2 * 24 * 60 * 60 * 1000),
        new Date(responseDueAt.getTime() - 2 * 24 * 60 * 60 * 1000)
      ]
    );
  }

  await pool.query(
    `INSERT INTO rti_attachments (id, rti_id, kind, file_path, file_mime, file_sha256, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       rti_id = EXCLUDED.rti_id,
       kind = EXCLUDED.kind,
       file_path = EXCLUDED.file_path,
       file_mime = EXCLUDED.file_mime,
       file_sha256 = EXCLUDED.file_sha256,
       note = EXCLUDED.note,
       created_at = EXCLUDED.created_at`,
    [
      deterministicUuid(`rti-attachment:${rtiId}`),
      rtiId,
      'DOCUMENT',
      `attachments/${rtiId}/supporting-note.pdf`,
      'application/pdf',
      createHash('sha256').update(`attachment:${rtiId}`).digest('hex'),
      'Seeded attachment note',
      submittedAt
    ]
  );

  return { rtiId, trackingToken, publicShareToken };
}

async function seedUserSupportTables(users: SeededUser[], roles: SeedUser['role'][]) {
  for (const [index, user] of users.entries()) {
    await pool.query(
      `INSERT INTO user_privacy_profiles (
        user_id, is_admin, is_authority, is_contractor, is_citizen, can_view_user_ids, authority_jurisdiction,
        contractor_assignment, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      ON CONFLICT (user_id) DO UPDATE SET
        is_admin = EXCLUDED.is_admin,
        is_authority = EXCLUDED.is_authority,
        is_contractor = EXCLUDED.is_contractor,
        is_citizen = EXCLUDED.is_citizen,
        can_view_user_ids = EXCLUDED.can_view_user_ids,
        authority_jurisdiction = EXCLUDED.authority_jurisdiction,
        contractor_assignment = EXCLUDED.contractor_assignment,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        user.dbId,
        user.role === 'CE',
        user.role === 'EE' || user.role === 'CE',
        user.role === 'CONTRACTOR',
        user.role === 'CITIZEN',
        user.role !== 'CITIZEN',
        user.role === 'EE' || user.role === 'CE' ? user.districts : [],
        user.role === 'CONTRACTOR' ? JSON.stringify({ districts: user.districts, zones: user.zones }) : null,
        new Date(),
        new Date()
      ]
    );

    await pool.query(
      `INSERT INTO karma_records (
        user_id, score, tier, daily_submission_count, last_submission_date, penalty_count,
        last_penalty_at, suspended_until, ban_reason, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id) DO UPDATE SET
        score = EXCLUDED.score,
        tier = EXCLUDED.tier,
        daily_submission_count = EXCLUDED.daily_submission_count,
        last_submission_date = EXCLUDED.last_submission_date,
        penalty_count = EXCLUDED.penalty_count,
        last_penalty_at = EXCLUDED.last_penalty_at,
        suspended_until = EXCLUDED.suspended_until,
        ban_reason = EXCLUDED.ban_reason,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        user.dbId,
        user.role === 'CITIZEN' ? 120 + index * 2 : user.role === 'CONTRACTOR' ? 135 + index : 200 + index,
        user.role === 'CITIZEN' ? 'Citizen' : user.role === 'CONTRACTOR' ? 'Partner' : 'Authority',
        user.role === 'CITIZEN' ? (index % 4) + 1 : 0,
        user.role === 'CITIZEN' ? new Date('2026-03-01T00:00:00Z').toISOString().slice(0, 10) : null,
        user.role === 'CITIZEN' ? index % 3 : 0,
        null,
        null,
        null,
        new Date(),
        new Date()
      ]
    );

    const channels = user.role === 'CITIZEN' ? ['IN_APP', 'SMS'] : ['IN_APP', 'FCM', 'WHATSAPP'];
    await pool.query(
      `INSERT INTO notification_preferences (
        user_id, enabled_channels, dnd_enabled, dnd_start_minutes, dnd_end_minutes,
        time_zone, authority_batching, digest_minutes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id) DO UPDATE SET
        enabled_channels = EXCLUDED.enabled_channels,
        dnd_enabled = EXCLUDED.dnd_enabled,
        dnd_start_minutes = EXCLUDED.dnd_start_minutes,
        dnd_end_minutes = EXCLUDED.dnd_end_minutes,
        time_zone = EXCLUDED.time_zone,
        authority_batching = EXCLUDED.authority_batching,
        digest_minutes = EXCLUDED.digest_minutes,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        user.dbId,
        channels,
        user.role === 'CITIZEN' ? false : index % 2 === 0,
        1320,
        360,
        'Asia/Kolkata',
        user.role === 'CITIZEN' ? 'IMMEDIATE' : 'DAILY_DIGEST',
        60,
        new Date(),
        new Date()
      ]
    );
  }
}

async function seedInfrastructureTables() {
  const services = [
    { id: 'gateway-api', address: 'http://localhost:3100', healthUrl: '/health', description: 'Gateway API', healthy: true },
    { id: 'backend-api', address: 'http://localhost:3200', healthUrl: '/health', description: 'Backend API', healthy: true },
    { id: 'authority-node', address: 'http://localhost:3300', healthUrl: '/health', description: 'Authority node', healthy: true },
    { id: 'mobile-host', address: 'http://localhost:3400', healthUrl: '/health', description: 'Mobile host', healthy: true },
    { id: 'notifications', address: 'http://localhost:3500', healthUrl: '/health', description: 'Notification worker', healthy: true },
    { id: 'analytics', address: 'http://localhost:3600', healthUrl: '/health', description: 'Analytics worker', healthy: true }
  ];

  for (const service of services) {
    await pool.query(
      `INSERT INTO services (id, address, health_url, description, metadata, registered_at, last_health_check, is_healthy)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         address = EXCLUDED.address,
         health_url = EXCLUDED.health_url,
         description = EXCLUDED.description,
         metadata = EXCLUDED.metadata,
         registered_at = EXCLUDED.registered_at,
         last_health_check = EXCLUDED.last_health_check,
         is_healthy = EXCLUDED.is_healthy`,
      [service.id, service.address, service.healthUrl, service.description, JSON.stringify({ seeded: true }), new Date(), new Date(), service.healthy]
    );
  }

  for (let i = 0; i < 12; i += 1) {
    await pool.query(
      `INSERT INTO offline_queue (id, payload, synced, synced_at, retry_count, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         payload = EXCLUDED.payload,
         synced = EXCLUDED.synced,
         synced_at = EXCLUDED.synced_at,
         retry_count = EXCLUDED.retry_count,
         created_at = EXCLUDED.created_at`,
      [
        deterministicUuid(`offline:${i}`),
        JSON.stringify({ seeded: true, index: i, kind: i % 2 === 0 ? 'complaint_sync' : 'rti_sync' }),
        i % 3 === 0,
        i % 3 === 0 ? new Date() : null,
        i,
        new Date()
      ]
    );
  }

  const reportDates = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'];
  for (const date of reportDates) {
    await pool.query(
      `INSERT INTO daily_reports (report_date, total_complaints, resolved_count, pending_count, report_data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (report_date) DO UPDATE SET
         total_complaints = EXCLUDED.total_complaints,
         resolved_count = EXCLUDED.resolved_count,
         pending_count = EXCLUDED.pending_count,
         report_data = EXCLUDED.report_data,
         created_at = EXCLUDED.created_at`,
      [date, 120, 48, 72, JSON.stringify({ seeded: true, date }), new Date(date)]
    );
  }

  for (const index of [0, 1, 2, 3]) {
    await pool.query(
      `INSERT INTO processed_events (consumer_id, key, processed_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer_id, key) DO UPDATE SET processed_at = EXCLUDED.processed_at`,
      ['seed-consumer', `seed-event-${index}`, new Date()]
    );
    await pool.query(
      `INSERT INTO event_failures (consumer_id, key, failure_count, last_error, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (consumer_id, key) DO UPDATE SET
         failure_count = EXCLUDED.failure_count,
         last_error = EXCLUDED.last_error,
         updated_at = EXCLUDED.updated_at`,
      ['seed-consumer', `seed-event-${index}`, index, index % 2 === 0 ? 'seeded retry' : 'seeded transient error', new Date()]
    );
  }

  const idempotencyRows = [
    { scope: 'complaint:create', key: 'seed-1' },
    { scope: 'rti:create', key: 'seed-2' },
    { scope: 'rti:response:add', key: 'seed-3' }
  ];
  for (const row of idempotencyRows) {
    await pool.query(
      `INSERT INTO api_idempotency_keys (scope, idempotency_key, request_hash, response_code, response_body, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (scope, idempotency_key) DO UPDATE SET
         request_hash = EXCLUDED.request_hash,
         response_code = EXCLUDED.response_code,
         response_body = EXCLUDED.response_body,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [row.scope, row.key, createHash('sha256').update(`${row.scope}:${row.key}`).digest('hex'), 200, JSON.stringify({ seeded: true }), new Date(), new Date()]
    );
  }
}

async function main() {
  const [dbModule, postgresModule, analyticsModule] = await Promise.all([
    import('../src/db.js'),
    import('../src/postgres.js'),
    import('../src/analytics/service.js')
  ]);

  const {
    bulkUpsertRoads,
    initDb,
    upsertAuthorityDirectory,
    upsertCountry,
    upsertDistrict,
    upsertState,
    upsertUser,
    getUserByPhone
  } = dbModule;
  const { pool: importedPool } = postgresModule;
  const { trackAnalyticsEvent: analyticsTrackEvent } = analyticsModule as typeof import('../src/analytics/service.js');

  pool = importedPool;
  trackAnalyticsEvent = analyticsTrackEvent;

  await initDb();

  const seedPassword = 'RoadWatch@123';

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
              : authorityName.includes('Tamil')
                ? 'Chennai'
                : authorityName.includes('Telangana')
                  ? 'Hyderabad'
                  : authorityName.includes('Gujarat')
                    ? 'Ahmedabad'
                    : authorityName.includes('West Bengal')
                      ? 'Kolkata'
                      : 'Thiruvananthapuram'
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

    await pool.query(
      `INSERT INTO districts_by_state (
        country_code, state_code, code, id, name,
        top_left_lat, top_left_lng, bottom_right_lat, bottom_right_lng,
        min_zoom, max_zoom, tile_style_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (country_code, state_code, code) DO UPDATE SET
        id = EXCLUDED.id,
        name = EXCLUDED.name,
        top_left_lat = EXCLUDED.top_left_lat,
        top_left_lng = EXCLUDED.top_left_lng,
        bottom_right_lat = EXCLUDED.bottom_right_lat,
        bottom_right_lng = EXCLUDED.bottom_right_lng,
        min_zoom = EXCLUDED.min_zoom,
        max_zoom = EXCLUDED.max_zoom,
        tile_style_url = EXCLUDED.tile_style_url`,
      [
        'IN',
        district.stateCode,
        district.districtCode,
        districtRow.id,
        district.districtName,
        buildBoundingBox(district.center).topLeft.lat,
        buildBoundingBox(district.center).topLeft.lng,
        buildBoundingBox(district.center).bottomRight.lat,
        buildBoundingBox(district.center).bottomRight.lng,
        10,
        16,
        null
      ]
    );

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
    email: adminSeed.email,
    role: adminSeed.role,
    govtId: adminSeed.govtId,
    districts: adminSeed.districts,
    zones: adminSeed.zones
  });
  const adminUser: SeededUser = { ...adminSeed, dbId: admin.id };

  const officers: SeededUser[] = [];
  for (const seed of officerSeeds) {
    const user = await upsertUser({
      phone: seed.phone,
      username: seed.username,
      email: seed.email ?? undefined,
      role: seed.role,
      govtId: seed.govtId,
      districts: seed.districts,
      zones: seed.zones
    });
    officers.push({ ...seed, dbId: user.id });
  }

  const citizens: SeededUser[] = [];
  for (const seed of citizenSeeds) {
    const user = await upsertUser({
      phone: seed.phone,
      username: seed.username,
      email: seed.email ?? undefined,
      role: seed.role,
      govtId: seed.govtId,
      districts: seed.districts,
      zones: seed.zones
    });
    citizens.push({ ...seed, dbId: user.id });
  }

  const contractorUsers: SeededUser[] = [];
  for (const seed of contractorUserSeeds) {
    const user = await upsertUser({
      phone: seed.phone,
      username: seed.username,
      email: seed.email ?? undefined,
      role: seed.role,
      govtId: seed.govtId,
      districts: seed.districts,
      zones: seed.zones
    });
    contractorUsers.push({ ...seed, dbId: user.id });
  }

  for (const seed of [adminUser, ...officers, ...citizens, ...contractorUsers]) {
    await setPasswordForUser(seed.dbId, seedPassword);
  }

  await writeCredentialFile(seedPassword, [adminUser, ...officers, ...citizens, ...contractorUsers]);

  await seedUserSupportTables([adminUser, ...officers, ...citizens, ...contractorUsers], ['CE', 'EE', 'CONTRACTOR', 'CITIZEN']);

  for (const contractor of contractorSeeds) {
    await pool.query(
      `INSERT INTO contractors (id, name, registration_number, contact_phone_masked, districts, zones, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         registration_number = EXCLUDED.registration_number,
         contact_phone_masked = EXCLUDED.contact_phone_masked,
         districts = EXCLUDED.districts,
         zones = EXCLUDED.zones`,
      [
        contractor.id,
        contractor.name,
        contractor.registrationNumber,
        contractor.contactPhoneMasked,
        contractor.districts,
        contractor.zones,
        new Date()
      ]
    );
  }

  const roadsByDistrict = new Map<string, Array<{ id: string; name: string; authorityId: string }>>();
  for (const district of districtSeeds) {
    roadsByDistrict.set(
      district.districtName,
      district.roads.map((road) => ({ id: road.id, name: road.name, authorityId: district.authorityId }))
    );
  }

  const complaintPattern = Array.from({ length: complaintCountSummary() }, (_, index) => deterministicUuid(`complaint:${index + 1}`));
  const rng = mulberry32(0x524f4144);
  const complaints: SeedComplaint[] = [];
  const complaintSubmittedEvents: Array<{ topic: string; event: ComplaintSubmittedEvent; key: string }> = [];
  const kafkaProducer = new KafkaProducer();
  const baseDate = new Date('2026-03-01T08:00:00.000Z');

  const citizensByDistrict = new Map<string, SeededUser[]>();
  for (const citizen of citizens) {
    for (const district of citizen.districts) {
      if (district === 'ALL') {
        continue;
      }
      const districtCitizens = citizensByDistrict.get(district) ?? [];
      districtCitizens.push(citizen);
      citizensByDistrict.set(district, districtCitizens);
    }
  }

  const officersByDistrict = new Map<string, SeededUser[]>();
  for (const officer of officers) {
    for (const district of officer.districts) {
      if (district === 'ALL') {
        continue;
      }
      const districtOfficers = officersByDistrict.get(district) ?? [];
      districtOfficers.push(officer);
      officersByDistrict.set(district, districtOfficers);
    }
  }

  const complaintCountByDistrict = new Map<string, number>();

  for (const [complaintIndex, district] of Array.from({ length: complaintCountSummary() }, (_, index) => districtSeeds[index % districtSeeds.length]!).entries()) {
    const districtRoads = roadsByDistrict.get(district.districtName) ?? [];
    const districtComplaintIndex = complaintCountByDistrict.get(district.districtName) ?? 0;
    const citizenPool = citizensByDistrict.get(district.districtName) ?? citizens;
    const officerPool = officersByDistrict.get(district.districtName) ?? officers;
    const citizen = citizenPool[districtComplaintIndex % citizenPool.length]!;
    const officer = officerPool[districtComplaintIndex % officerPool.length]!;
    const contractor = contractorSeeds[(complaintIndex + districtComplaintIndex) % contractorSeeds.length]!;
    const road = districtRoads[districtComplaintIndex % districtRoads.length] ?? {
      id: district.roads[0]!.id,
      name: district.roads[0]!.name,
      authorityId: district.authorityId
    };
    const createdAt = new Date(baseDate.getTime() + complaintIndex * 7 * 60 * 60 * 1000);
    const assignedAt = new Date(createdAt.getTime() + 6 * 60 * 60 * 1000);
    const status = complaintStatus(complaintIndex);
    const resolutionDeltaDays = status === 'RESOLVED'
      ? 2 + (complaintIndex % 8)
      : status === 'ESCALATED'
        ? 4 + (complaintIndex % 3)
        : 1 + (complaintIndex % 2);
    const updatedAt = new Date(assignedAt.getTime() + resolutionDeltaDays * 24 * 60 * 60 * 1000);
    const location = offsetPoint(district.center, rng);
    const expectedResolutionDays = status === 'ESCALATED' ? 4 : status === 'IN_PROGRESS' ? 10 : 7;
    const aiScore = Number((0.45 + rng() * 0.5).toFixed(2));

    complaints.push({
      id: complaintPattern[complaintIndex]!,
      district: district.districtName,
      zone: district.zones[districtComplaintIndex % district.zones.length]!,
      roadId: road.id,
      roadName: road.name,
      authorityId: district.authorityId,
      authorityName: district.authorityName,
      contractorId: contractor.id,
      citizen,
      officer,
      status,
      title: `${road.name} repair request`,
      description: makeComplaintDescription(district.districtName, road.name, complaintIndex),
      damageType: ['Pothole', 'Drainage', 'Shoulder', 'Surface Crack', 'Markings'][complaintIndex % 5]!,
      severity: 1 + (complaintIndex % 5),
      lat: location.lat,
      lng: location.lng,
      createdAt,
      assignedAt,
      updatedAt,
      expectedResolutionDays,
      aiScore,
      repaired: status === 'RESOLVED' || (status === 'IN_PROGRESS' && complaintIndex % 3 === 0)
    });

    complaintCountByDistrict.set(district.districtName, districtComplaintIndex + 1);
  }

  await cleanupSeedRows(complaintPattern, seededRoadIds, seededContractorIds);

  for (const [index, complaint] of complaints.entries()) {
    const citizen = complaint.citizen;
    const officer = complaint.officer;
    const contractor = contractorSeeds.find((item) => item.id === complaint.contractorId)!;
    const officerPhoneHash = createHash('sha256').update(officer.phone).digest('hex');

    await seedComplaintRecord({ complaint, user: citizen, officer, contractor, officerPhoneHash });

    complaintSubmittedEvents.push({
      topic: KafkaTopics.complaintSubmitted,
      key: complaint.id,
      event: {
        type: 'complaint-submitted',
        idempotencyKey: `complaint:${complaint.id}:submitted`,
        occurredAt: complaint.createdAt.toISOString(),
        version: 1,
        complaintId: complaint.id,
        district: complaint.district,
        zone: complaint.zone,
        description: complaint.description,
        roadId: complaint.roadId,
        authorityOrg: complaint.authorityId,
        citizenId: citizen.dbId,
        location: {
          lat: complaint.lat,
          lng: complaint.lng,
          capturedAt: complaint.createdAt.toISOString()
        },
        merged: false,
        reportCount: 1
      }
    });

    await seedNotificationBundle({
      notificationId: deterministicUuid(`notification:${complaint.id}:created`),
      type: 'new_complaint',
      title: `Complaint filed for ${complaint.roadName}`,
      body: `${complaint.district} / ${complaint.zone} has a new complaint`,
      data: { complaintId: complaint.id, district: complaint.district, roadId: complaint.roadId, seeded: true },
      district: complaint.district,
      zone: complaint.zone,
      roadId: complaint.roadId,
      recipientRole: 'CITIZEN',
      recipientUsers: [citizen],
      createdAt: complaint.createdAt,
      critical: complaint.severity >= 4
    });

    const districtOfficers = officers.filter((officerUser) => officerUser.districts.includes(complaint.district) || officerUser.districts.includes('ALL'));
    await seedNotificationBundle({
      notificationId: deterministicUuid(`notification:${complaint.id}:assigned`),
      type: 'assignment',
      title: `Complaint ${complaint.id} assigned`,
      body: `Assigned to ${contractor.name} in ${complaint.district}`,
      data: { complaintId: complaint.id, contractorId: contractor.id, seeded: true },
      district: complaint.district,
      zone: complaint.zone,
      roadId: complaint.roadId,
      recipientRole: 'EE',
      recipientUsers: districtOfficers,
      createdAt: complaint.assignedAt,
      critical: complaint.status === 'ESCALATED'
    });

    if (complaint.status === 'RESOLVED' || complaint.status === 'ESCALATED') {
      await seedNotificationBundle({
        notificationId: deterministicUuid(`notification:${complaint.id}:closed`),
        type: complaint.status === 'RESOLVED' ? 'resolved' : 'escalation',
        title: complaint.status === 'RESOLVED' ? `Complaint ${complaint.id} resolved` : `Complaint ${complaint.id} escalated`,
        body: complaint.status === 'RESOLVED' ? 'Repair verified and marked complete' : 'Escalated to higher authority',
        data: { complaintId: complaint.id, status: complaint.status, seeded: true },
        district: complaint.district,
        zone: complaint.zone,
        roadId: complaint.roadId,
        recipientRole: complaint.status === 'RESOLVED' ? 'CITIZEN' : 'EE',
        recipientUsers: complaint.status === 'RESOLVED' ? [citizen] : districtOfficers,
        createdAt: complaint.updatedAt,
        critical: complaint.status === 'ESCALATED'
      });
    }

    if (complaint.status === 'IN_PROGRESS' && complaint.expectedResolutionDays >= 10) {
      await seedNotificationBundle({
        notificationId: deterministicUuid(`notification:${complaint.id}:sla`),
        type: 'sla_warning',
        title: `SLA warning for ${complaint.id}`,
        body: 'This complaint is approaching its resolution threshold',
        data: { complaintId: complaint.id, seeded: true },
        district: complaint.district,
        zone: complaint.zone,
        roadId: complaint.roadId,
        recipientRole: 'EE',
        recipientUsers: districtOfficers,
        createdAt: new Date(complaint.updatedAt.getTime() + 24 * 60 * 60 * 1000),
        critical: true
      });
    }

    if ((index + 1) % 3 === 0) {
      await seedRtiBundle({ complaint, citizen, officer });
    }

    await pool.query(
      `INSERT INTO road_assignments (id, road_id, contractor_id, engineer_user_id, starts_on, ends_on, assigned_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         road_id = EXCLUDED.road_id,
         contractor_id = EXCLUDED.contractor_id,
         engineer_user_id = EXCLUDED.engineer_user_id,
         starts_on = EXCLUDED.starts_on,
         ends_on = EXCLUDED.ends_on,
         assigned_at = EXCLUDED.assigned_at,
         metadata = EXCLUDED.metadata`,
      [
        deterministicUuid(`road-assignment:${complaint.roadId}`),
        complaint.roadId,
        contractor.id,
        officer.dbId,
        '2026-01-01',
        '2026-12-31',
        complaint.assignedAt,
        JSON.stringify({ complaintId: complaint.id, district: complaint.district, seeded: true })
      ]
    );
  }

  const complaintRows = complaints.map((complaint) => ({
    complaint,
    citizen: complaint.citizen,
    officer: complaint.officer,
    contractor: contractorSeeds.find((item) => item.id === complaint.contractorId)!
  }));

  for (const complaintRow of complaintRows) {
    await pool.query(
      `INSERT INTO karma_ledger (user_id, delta, reason, ref_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        complaintRow.citizen.dbId,
        complaintRow.complaint.status === 'RESOLVED' ? 6 : complaintRow.complaint.status === 'ESCALATED' ? -2 : 2,
        `seed-${complaintRow.complaint.status.toLowerCase()}`,
        complaintRow.complaint.id,
        complaintRow.complaint.updatedAt
      ]
    );
  }

  await seedInfrastructureTables();

  for (const [index, user] of [...citizens, ...officers, ...contractorUsers].entries()) {
    await pool.query(
      `INSERT INTO otp_sessions (id, user_id, code, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         code = EXCLUDED.code,
         expires_at = EXCLUDED.expires_at`,
      [deterministicUuid(`otp:${user.dbId}`), user.dbId, String(100000 + index).slice(-6), new Date(Date.now() + 10 * 60 * 1000)]
    );
  }

  for (const [index, complaint] of complaints.slice(0, 10).entries()) {
    await pool.query(
      `INSERT INTO event_logs (id, event_type, entity_id, entity_type, event_data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (id) DO UPDATE SET
         event_type = EXCLUDED.event_type,
         entity_id = EXCLUDED.entity_id,
         entity_type = EXCLUDED.entity_type,
         event_data = EXCLUDED.event_data,
         created_at = EXCLUDED.created_at`,
      [
        deterministicUuid(`event:${complaint.id}:${index}`),
        'SEED_EVENT',
        complaint.id,
        'COMPLAINT',
        JSON.stringify({ seeded: true, index, complaintId: complaint.id }),
        complaint.createdAt
      ]
    );
  }

  for (const complaint of complaints.slice(0, 20)) {
    await pool.query(
      `INSERT INTO embeddings (upload_id, embedding, created_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (upload_id) DO UPDATE SET
         embedding = EXCLUDED.embedding,
         created_at = EXCLUDED.created_at`,
      [
        `EMB-${complaint.id}`,
        JSON.stringify({ seeded: true, complaintId: complaint.id, district: complaint.district }),
        complaint.createdAt
      ]
    );
  }

  try {
    await kafkaProducer.publishMany(complaintSubmittedEvents);
  } finally {
    await kafkaProducer.disconnect();
  }

  console.log(
    `[seed-demo] seeded: complaints=${complaints.length} citizens=${citizens.length} officers=${officers.length} contractorUsers=${contractorUsers.length} contractors=${contractorSeeds.length} districts=${districtSeeds.length}`
  );
  console.log(`[seed-demo] queued fabric-bound complaint-submitted events=${complaintSubmittedEvents.length}`);
  console.table([
    { account: adminSeed.label, username: adminSeed.username, phone: adminSeed.phone, role: adminSeed.role, districts: adminSeed.districts.join(', '), seedKarma: 200 },
    ...officers.slice(0, 4).map((officer) => ({ account: officer.label, username: officer.username, phone: officer.phone, role: officer.role, districts: officer.districts.join(', '), seedKarma: 145 })),
    ...citizens.slice(0, 4).map((citizen) => ({ account: citizen.label, username: citizen.username, phone: citizen.phone, role: citizen.role, districts: citizen.districts.join(', '), seedKarma: 120 })),
    ...contractorUsers.slice(0, 4).map((contractor) => ({ account: contractor.label, username: contractor.username, phone: contractor.phone, role: contractor.role, districts: contractor.districts.join(', '), seedKarma: 130 }))
  ]);
}

main().catch((err) => {
  console.error('[seed-demo] failed:', err);
  process.exit(1);
});
