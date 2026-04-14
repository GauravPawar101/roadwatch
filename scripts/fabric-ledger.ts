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

    const fixtures = [
      {
        complaintId: TEST_IDS.complaints.complaint1,
        roadId: TEST_IDS.roads.road1,
        authorityOrg: process.env.RW_TEST_AUTHORITY_ORG ?? 'NHAI',
        locationJson: JSON.stringify({ lat: 28.6139, lng: 77.209 })
      },
      {
        complaintId: TEST_IDS.complaints.complaint2,
        roadId: TEST_IDS.roads.road3,
        authorityOrg: process.env.RW_TEST_AUTHORITY_ORG ?? 'NHAI',
        locationJson: JSON.stringify({ lat: 19.076, lng: 72.8777 })
      }
    ];

    for (const f of fixtures) {
      const historyBytes = await contract.evaluateTransaction('GetComplaintHistory', f.complaintId);
      const historyText = Buffer.from(historyBytes).toString('utf8').trim();
      const history = historyText ? (JSON.parse(historyText) as unknown[]) : [];

      if (Array.isArray(history) && history.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[fabric-ledger] exists: complaintId=${f.complaintId} (history=${history.length})`);
        continue;
      }

      const transient = {
        pii: Buffer.from(
          JSON.stringify({
            CitizenID: TEST_IDS.citizenId,
            Location: f.locationJson,
            InitialIPFSCid: 'cid-seeded'
          }),
          'utf8'
        )
      };

      const proposal = contract.newProposal('CreateComplaint', {
        arguments: [
          f.complaintId,
          TEST_IDS.citizenId,
          f.roadId,
          f.locationJson,
          'cid-seeded',
          f.authorityOrg,
          'details-hash-seeded'
        ],
        transientData: transient
      });

      const endorsed = await proposal.endorse();
      const committed = await endorsed.submit();
      await committed.getStatus();

      // eslint-disable-next-line no-console
      console.log(`[fabric-ledger] seeded: complaintId=${f.complaintId} roadId=${f.roadId}`);
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
