import * as grpc from '@grpc/grpc-js';
import { connect, signers, type Contract, type Gateway } from '@hyperledger/fabric-gateway';
import crypto from 'crypto';
import { promises as fs } from 'fs';

type Env = NodeJS.ProcessEnv;

type ComplaintLedgerInput = {
  complaintId: string;
  citizenId: string;
  roadId: string;
  location: Record<string, unknown>;
  initialIPFSCid: string;
  authorityOrg: string;
  detailsHash?: string;
  merged?: boolean;
  reportCount?: number;
  eventIdempotencyKey?: string;
};

type ComplaintHistoryEntry = {
  txId: string;
  timestamp: unknown;
  isDelete: boolean;
  value: unknown;
};

function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value.trim();
}

function parseHistoryPayload(result: Uint8Array): ComplaintHistoryEntry[] {
  const parsed = JSON.parse(Buffer.from(result).toString('utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected Fabric history payload');
  }
  return parsed as ComplaintHistoryEntry[];
}

class FabricLedgerService {
  private gateway: Gateway | null = null;
  private contract: Contract | null = null;
  private initPromise: Promise<void> | null = null;

  private async ensureConnected(): Promise<void> {
    if (this.contract) return;
    if (!this.initPromise) {
      this.initPromise = this.connect();
    }
    await this.initPromise;
  }

  private async connect(): Promise<void> {
    const env = process.env;
    const tlsCertPath = requireEnv(env, 'FABRIC_TLS_CERT_PATH');
    const peerEndpoint = requireEnv(env, 'FABRIC_PEER_ENDPOINT');
    const peerHostAlias = requireEnv(env, 'FABRIC_PEER_HOST_ALIAS');
    const channelName = requireEnv(env, 'FABRIC_CHANNEL_NAME');
    const chaincodeName = requireEnv(env, 'FABRIC_CHAINCODE_NAME');
    const mspId = requireEnv(env, 'FABRIC_MSP_ID');
    const x509CertPath = requireEnv(env, 'FABRIC_X509_CERT_PATH');
    const x509KeyPath = requireEnv(env, 'FABRIC_X509_KEY_PATH');

    const [certificate, privateKeyPem, tlsRootCertificate] = await Promise.all([
      fs.readFile(x509CertPath, 'utf8'),
      fs.readFile(x509KeyPath, 'utf8'),
      fs.readFile(tlsCertPath)
    ]);

    const grpcCredentials = grpc.credentials.createSsl(tlsRootCertificate);
    const grpcClient = new grpc.Client(peerEndpoint, grpcCredentials, {
      'grpc.ssl_target_name_override': peerHostAlias
    });

    this.gateway = connect({
      client: grpcClient,
      identity: { mspId, credentials: Uint8Array.from(Buffer.from(certificate)) },
      signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem)),
      evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
      submitOptions: () => ({ deadline: Date.now() + 10_000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60_000 })
    });

    const network = this.gateway.getNetwork(channelName);
    this.contract = network.getContract(chaincodeName);
  }

  async createComplaint(input: ComplaintLedgerInput): Promise<string> {
    await this.ensureConnected();
    const proposal = this.contract!.newProposal('UpsertComplaintSubmission', {
      arguments: [
        input.complaintId,
        input.citizenId,
        input.roadId,
        JSON.stringify(input.location),
        input.initialIPFSCid,
        input.authorityOrg,
        input.detailsHash ?? '',
        input.eventIdempotencyKey ?? `complaint:${input.complaintId}:submitted`,
        input.merged ? '1' : '0',
        String(input.reportCount ?? 1)
      ]
    });

    const endorsed = await proposal.endorse();
    const submitted = await endorsed.submit();
    const status = await submitted.getStatus();
    if (!status.successful) {
      throw new Error(`Fabric complaint create failed: ${status.transactionId}`);
    }
    return status.transactionId;
  }

  async updateComplaintStatus(
    complaintId: string,
    newStatus: string,
    officialEmployeeId: string,
    eventIdempotencyKey?: string
  ): Promise<string> {
    await this.ensureConnected();
    const proposal = this.contract!.newProposal('UpdateComplaintStatus', {
      arguments: [complaintId, newStatus, officialEmployeeId, eventIdempotencyKey ?? `complaint:${complaintId}:status:${newStatus}`]
    });

    const endorsed = await proposal.endorse();
    const submitted = await endorsed.submit();
    const status = await submitted.getStatus();
    if (!status.successful) {
      throw new Error(`Fabric complaint update failed: ${status.transactionId}`);
    }
    return status.transactionId;
  }

  async resolveComplaint(complaintId: string, resolutionIPFSCid: string, officialEmployeeId: string): Promise<string> {
    await this.ensureConnected();
    const proposal = this.contract!.newProposal('ResolveComplaint', {
      arguments: [complaintId, resolutionIPFSCid, officialEmployeeId]
    });

    const endorsed = await proposal.endorse();
    const submitted = await endorsed.submit();
    const status = await submitted.getStatus();
    if (!status.successful) {
      throw new Error(`Fabric complaint resolve failed: ${status.transactionId}`);
    }
    return status.transactionId;
  }

  async getComplaintHistory(complaintId: string): Promise<ComplaintHistoryEntry[]> {
    await this.ensureConnected();
    const result = await this.contract!.evaluateTransaction('GetComplaintHistory', complaintId);
    return parseHistoryPayload(result);
  }
}

export const fabricLedgerService = new FabricLedgerService();