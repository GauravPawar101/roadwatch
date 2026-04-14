import { SQLiteLocalStore } from './SQLiteLocalStore';

function readEnv(key: string): string | undefined {
   try {
      const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
      return env?.[key];
   } catch {
      return undefined;
   }
}

const TEST_IDS = {
   citizenId: readEnv('RW_TEST_CITIZEN_ID') ?? 'CITIZEN-TEST-001',
   regionCode: readEnv('RW_TEST_REGION_CODE') ?? 'DL-ND',
   roadType: readEnv('RW_TEST_ROAD_TYPE') ?? 'ARTERIAL',
   authorityId: readEnv('RW_TEST_AUTHORITY_ID') ?? 'AUTH-DL',
   roads: {
      road1: readEnv('RW_TEST_ROAD_ID_1') ?? 'RD-DL-001',
      road2: readEnv('RW_TEST_ROAD_ID_2') ?? 'RD-DL-002',
      road3: readEnv('RW_TEST_ROAD_ID_3') ?? 'RD-MH-001',
      road4: readEnv('RW_TEST_ROAD_ID_4') ?? 'RD-MH-002'
   },
   complaints: {
      complaint1: readEnv('RW_TEST_COMPLAINT_ID_1') ?? 'COMPLAINT-TEST-0001',
      complaint2: readEnv('RW_TEST_COMPLAINT_ID_2') ?? 'COMPLAINT-TEST-0002'
   },
   proofHashSha256:
      readEnv('RW_TEST_PROOF_HASH_SHA256') ??
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
} as const;

/**
 * Structural Local Initialization Framework.
 * Mounts massive local execution blocks seamlessly onto raw installations automatically preventing App deadlock.
 */
export async function seedLocalDatabase(store: SQLiteLocalStore): Promise<void> {
   const hasSeeded = await store.load('SYS_SEED_LOCK_V1');
   if (hasSeeded) {
      console.log('[SQLiteSeeder]: Already seeded. Skipping.');
      return;
   }

   console.log('[SQLiteSeeder]: Seeding deterministic local fixtures...');

   const localRoads = [
      {
         id: TEST_IDS.roads.road1,
         name: 'Ring Road',
         roadType: 'ARTERIAL',
         regionCode: 'DL-ND',
         authorityId: TEST_IDS.authorityId,
         boundingBox: { minLat: 28.4, maxLat: 28.889, minLng: 76.84, maxLng: 77.35 }
      },
      {
         id: TEST_IDS.roads.road2,
         name: 'Outer Ring Road',
         roadType: 'ARTERIAL',
         regionCode: 'DL-ND',
         authorityId: TEST_IDS.authorityId,
         boundingBox: { minLat: 28.4, maxLat: 28.889, minLng: 76.84, maxLng: 77.35 }
      },
      {
         id: TEST_IDS.roads.road3,
         name: 'Western Express Highway',
         roadType: 'HIGHWAY',
         regionCode: 'MH-MUM',
         authorityId: 'AUTH-MH',
         boundingBox: { minLat: 18.89, maxLat: 19.33, minLng: 72.72, maxLng: 73.05 }
      },
      {
         id: TEST_IDS.roads.road4,
         name: 'Eastern Express Highway',
         roadType: 'HIGHWAY',
         regionCode: 'MH-MUM',
         authorityId: 'AUTH-MH',
         boundingBox: { minLat: 18.89, maxLat: 19.33, minLng: 72.72, maxLng: 73.05 }
      }
   ];

   const localComplaints = [
      {
         id: TEST_IDS.complaints.complaint1,
         roadId: TEST_IDS.roads.road1,
         userId: TEST_IDS.citizenId,
         description: 'Test complaint: pothole near junction (seeded).',
         status: 'PENDING_OFFLINE_SYNC',
         proofHash: TEST_IDS.proofHashSha256
      },
      {
         id: TEST_IDS.complaints.complaint2,
         roadId: TEST_IDS.roads.road3,
         userId: TEST_IDS.citizenId,
         description: 'Test complaint: broken drain cover (seeded).',
         status: 'RECEIPT_VERIFIED_ONLINE',
         proofHash: TEST_IDS.proofHashSha256
      }
   ];

   await store.save('SYS_ROADS_INDEX_ARRAY', localRoads);
   await store.save('SYS_COMPLAINTS_INDEX_ARRAY', localComplaints);
   await store.save('SYS_TEST_IDS_V1', {
      ...TEST_IDS,
      seededAt: new Date().toISOString()
   });

   await store.save('SYS_SEED_LOCK_V1', true);

   console.log('[SQLiteSeeder]: Local fixtures seeded.');
}
