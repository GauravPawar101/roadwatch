export const TEST_IDS = {
  citizenId: process.env.RW_TEST_CITIZEN_ID ?? 'CITIZEN-TEST-001',
  countryCode: process.env.RW_TEST_COUNTRY_CODE ?? 'IN',
  stateCode: process.env.RW_TEST_STATE_CODE ?? 'DL',
  regionCode: process.env.RW_TEST_REGION_CODE ?? 'DL-ND',
  districts: {
    dlNd: process.env.RW_TEST_DISTRICT_ID_DL_ND ?? 'b8b5c1d6-3f1e-4c73-9a09-2b2d74c18b6e',
    mhMum: process.env.RW_TEST_DISTRICT_ID_MH_MUM ?? '7a01f2c1-2e3b-4c19-9e15-0a1d0d66be33'
  },
  roadType: process.env.RW_TEST_ROAD_TYPE ?? 'ARTERIAL',
  authorityId: process.env.RW_TEST_AUTHORITY_ID ?? 'AUTH-DL',
  roads: {
    road1: process.env.RW_TEST_ROAD_ID_1 ?? 'RD-DL-001',
    road2: process.env.RW_TEST_ROAD_ID_2 ?? 'RD-DL-002',
    road3: process.env.RW_TEST_ROAD_ID_3 ?? 'RD-MH-001',
    road4: process.env.RW_TEST_ROAD_ID_4 ?? 'RD-MH-002'
  },
  complaints: {
    complaint1: process.env.RW_TEST_COMPLAINT_ID_1 ?? 'COMPLAINT-TEST-0001',
    complaint2: process.env.RW_TEST_COMPLAINT_ID_2 ?? 'COMPLAINT-TEST-0002'
  },
  proofHashSha256:
    process.env.RW_TEST_PROOF_HASH_SHA256 ??
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
} as const;

export function isDeterministicSeedEnabled(): boolean {
  const v = (process.env.RW_SEED_DETERMINISTIC ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
