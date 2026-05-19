import * as grpc from '@grpc/grpc-js';
import { connect, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// This is a *real* integration test suite, but it is intentionally opt-in.
// It requires a local Fabric network + deployed chaincode.
//
// Enable with:
//   FABRIC_TEST_ENABLED=1 pnpm test:fabric
//
// Required env vars (suggested):
//   FABRIC_PEER_ENDPOINT=localhost:7051
//   FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
//   FABRIC_TLS_CERT_PATH=/abs/path/to/peer/tls/ca.crt
//   FABRIC_MSP_ID=Org1MSP
//   FABRIC_IDENTITY_CERT_PATH=/abs/path/to/user/cert.pem
//   FABRIC_IDENTITY_KEY_PATH=/abs/path/to/user/key.pem
//   FABRIC_CHANNEL=mychannel
//   FABRIC_CHAINCODE=roadwatch

const enabled = process.env.FABRIC_TEST_ENABLED === '1';

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

function getFabricEnv(): FabricEnv {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
  };

  return {
    peerEndpoint: required('FABRIC_PEER_ENDPOINT'),
    peerHostAlias: required('FABRIC_PEER_HOST_ALIAS'),
    tlsCertPath: required('FABRIC_TLS_CERT_PATH'),
    mspId: required('FABRIC_MSP_ID'),
    identityCertPath: required('FABRIC_IDENTITY_CERT_PATH'),
    identityKeyPath: required('FABRIC_IDENTITY_KEY_PATH'),
    channel: required('FABRIC_CHANNEL'),
    chaincode: required('FABRIC_CHAINCODE')
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

describe('Fabric chaincode integration', () => {
  it.skipIf(!enabled)('anchors and verifies a Merkle root', async () => {
    const env = getFabricEnv();
    const gateway = await connectGateway(env);

    try {
      const network = gateway.getNetwork(env.channel);
      const contract = network.getContract(env.chaincode);

      const merkleRoot = crypto
        .createHash('sha256')
        .update(crypto.randomBytes(32))
        .digest('hex');

      // SubmitMerkleRoot(ctx, merkleRoot, regionCode, batchSize)
      const proposal = contract.newProposal('SubmitMerkleRoot', {
        arguments: [merkleRoot, 'MH', '1']
      });

      const endorsed = await proposal.endorse();
      const committed = await endorsed.submit();
      await committed.getStatus();

      const verifyBytes = await contract.evaluateTransaction('VerifyMerkleRoot', merkleRoot);
      const verify = JSON.parse(Buffer.from(verifyBytes).toString('utf8')) as {
        merkleRoot: string;
      };

      expect(verify.merkleRoot).toBe(merkleRoot);
    } finally {
      gateway.close();
    }
  });
});
