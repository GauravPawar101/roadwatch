import * as grpc from '@grpc/grpc-js';
import { connect, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TEST_IDS } from './test-ids';

type FabricEnv = {
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  mspId: string;
  identityCertPath: string;
  identityKeyPath: string;
  channel: string;
  chaincode: string;
};

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getFabricEnv(): FabricEnv {
  return {
    peerEndpoint: requiredEnv('FABRIC_PEER_ENDPOINT'),
    peerHostAlias: requiredEnv('FABRIC_PEER_HOST_ALIAS'),
    tlsCertPath: requiredEnv('FABRIC_TLS_CERT_PATH'),
    mspId: requiredEnv('FABRIC_MSP_ID'),
    identityCertPath: requiredEnv('FABRIC_IDENTITY_CERT_PATH'),
    identityKeyPath: requiredEnv('FABRIC_IDENTITY_KEY_PATH'),
    channel: requiredEnv('FABRIC_CHANNEL'),
    chaincode: requiredEnv('FABRIC_CHAINCODE')
  };
}

async function connectGateway(env: FabricEnv) {
  const [tlsCert, identityCert, identityKeyPem] = await Promise.all([
    readFile(env.tlsCertPath),
    readFile(env.identityCertPath),
    readFile(env.identityKeyPath, 'utf8')
  ]);

  const credentials = grpc.credentials.createSsl(tlsCert);
  const grpcClient = new grpc.Client(env.peerEndpoint, credentials, {
    'grpc.ssl_target_name_override': env.peerHostAlias
  });

  return connect({
    client: grpcClient,
    identity: { mspId: env.mspId, credentials: identityCert },
    signer: signers.newPrivateKeySigner(crypto.createPrivateKey(identityKeyPem)),
    evaluateOptions: () => ({ deadline: Date.now() + 10_000 }),
    endorseOptions: () => ({ deadline: Date.now() + 30_000 }),
    submitOptions: () => ({ deadline: Date.now() + 30_000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60_000 })
  });
}

function parseArgs(argv: string[]) {
  const cmd = argv[0];
  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith('--')) continue;
    const key = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith('--')) {
      flags.set(key, v);
      i++;
    } else {
      flags.set(key, '1');
    }
  }
  return { cmd, flags };
}

function usage() {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  pnpm tsx scripts/fabric-ledger.ts seed
  pnpm tsx scripts/fabric-ledger.ts history --complaintId <id>
  pnpm tsx scripts/fabric-ledger.ts by-road --roadId <id>

Required env vars:
  FABRIC_PEER_ENDPOINT, FABRIC_PEER_HOST_ALIAS, FABRIC_TLS_CERT_PATH,
  FABRIC_MSP_ID, FABRIC_IDENTITY_CERT_PATH, FABRIC_IDENTITY_KEY_PATH,
  FABRIC_CHANNEL, FABRIC_CHAINCODE

Optional test-id env vars:
  RW_TEST_COMPLAINT_ID_1, RW_TEST_COMPLAINT_ID_2, RW_TEST_ROAD_ID_*, RW_TEST_CITIZEN_ID
`);
}

async function seedDeterministicComplaints() {
  const env = getFabricEnv();
  const gateway = await connectGateway(env);

  try {
    const network = gateway.getNetwork(env.channel);
    const contract = network.getContract(env.chaincode);

    await contract.submitTransaction('InitLedger');

    const rootSeeds = [
      { regionCode: 'IN-DL', batchSize: 12, seed: 'roadwatch-fabric-seed-1' },
      { regionCode: 'IN-MH', batchSize: 8, seed: 'roadwatch-fabric-seed-2' }
    ];

    for (const rootSeed of rootSeeds) {
      const merkleRoot = crypto.createHash('sha256').update(rootSeed.seed).digest('hex');
      try {
        const existingBytes = await contract.evaluateTransaction('VerifyMerkleRoot', merkleRoot);
        const existing = JSON.parse(Buffer.from(existingBytes).toString('utf8')) as { anchorId?: string };
        // eslint-disable-next-line no-console
        console.log(`[fabric-ledger] exists: merkleRoot=${merkleRoot} anchorId=${existing.anchorId ?? 'unknown'}`);
      } catch {
        await contract.submitTransaction('SubmitMerkleRoot', merkleRoot, rootSeed.regionCode, String(rootSeed.batchSize));
        // eslint-disable-next-line no-console
        console.log(`[fabric-ledger] seeded: merkleRoot=${merkleRoot} region=${rootSeed.regionCode}`);
      }
    }

    const escalationFixtures = [
      {
        complaintId: TEST_IDS.complaints.complaint1,
        fromAuthorityId: 'AUTH-DL',
        toAuthorityId: 'AUTH-MH',
        tier: 1,
        daysOpen: 8
      },
      {
        complaintId: TEST_IDS.complaints.complaint2,
        fromAuthorityId: 'AUTH-MH',
        toAuthorityId: 'AUTH-UP',
        tier: 2,
        daysOpen: 14
      }
    ];

    for (const escalation of escalationFixtures) {
      await contract.submitTransaction(
        'AnchorEscalation',
        escalation.complaintId,
        escalation.fromAuthorityId,
        escalation.toAuthorityId,
        String(escalation.tier),
        String(escalation.daysOpen)
      );
      // eslint-disable-next-line no-console
      console.log(`[fabric-ledger] seeded: complaintId=${escalation.complaintId} escalationTier=${escalation.tier}`);
    }

    const resolutionFixtures = [
      {
        complaintId: TEST_IDS.complaints.complaint1,
        resolvedBy: 'AUTH-PERSON-DL-01',
        repairCID: 'Qm' + 'a'.repeat(44),
        captureHash: crypto.createHash('sha256').update('roadwatch-fabric-resolution-1').digest('hex')
      },
      {
        complaintId: TEST_IDS.complaints.complaint2,
        resolvedBy: 'AUTH-PERSON-MH-01',
        repairCID: 'bafy' + 'b'.repeat(55),
        captureHash: crypto.createHash('sha256').update('roadwatch-fabric-resolution-2').digest('hex')
      }
    ];

    for (const resolution of resolutionFixtures) {
      try {
        const existingBytes = await contract.evaluateTransaction('GetResolutionProof', resolution.complaintId);
        const existing = JSON.parse(Buffer.from(existingBytes).toString('utf8')) as { anchorId?: string };
        // eslint-disable-next-line no-console
        console.log(`[fabric-ledger] exists: complaintId=${resolution.complaintId} resolution=${existing.anchorId ?? 'present'}`);
      } catch {
        await contract.submitTransaction(
          'AnchorResolution',
          resolution.complaintId,
          resolution.resolvedBy,
          resolution.repairCID,
          resolution.captureHash
        );
        // eslint-disable-next-line no-console
        console.log(`[fabric-ledger] seeded: complaintId=${resolution.complaintId} resolution anchored`);
      }
    }
  } finally {
    gateway.close();
  }
}

async function queryHistory(complaintId: string) {
  const env = getFabricEnv();
  const gateway = await connectGateway(env);

  try {
    const network = gateway.getNetwork(env.channel);
    const contract = network.getContract(env.chaincode);

    const historyBytes = await contract.evaluateTransaction('GetComplaintHistory', complaintId);
    const historyText = Buffer.from(historyBytes).toString('utf8');

    // eslint-disable-next-line no-console
    console.log(historyText);
  } finally {
    gateway.close();
  }
}

async function queryByRoad(roadId: string) {
  const env = getFabricEnv();
  const gateway = await connectGateway(env);

  try {
    const network = gateway.getNetwork(env.channel);
    const contract = network.getContract(env.chaincode);

    const resultsBytes = await contract.evaluateTransaction('QueryComplaintsByRoad', roadId);
    const text = Buffer.from(resultsBytes).toString('utf8');

    // eslint-disable-next-line no-console
    console.log(text);
  } finally {
    gateway.close();
  }
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));

  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage();
    process.exit(0);
  }

  if (cmd === 'seed') {
    await seedDeterministicComplaints();
    return;
  }

  if (cmd === 'history') {
    const complaintId = flags.get('complaintId') ?? TEST_IDS.complaints.complaint1;
    await queryHistory(complaintId);
    return;
  }

  if (cmd === 'by-road') {
    const roadId = flags.get('roadId') ?? TEST_IDS.roads.road1;
    await queryByRoad(roadId);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[fabric-ledger] failed:', err);
  process.exit(1);
});
