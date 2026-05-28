import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readFile = vi.fn(async (filePath: string, encoding?: BufferEncoding) => {
    if (filePath === '/tls.pem') {
      return Buffer.from('TLS CERTIFICATE');
    }

    if (encoding === 'utf8' && filePath === '/cert.pem') {
      return 'CERTIFICATE';
    }

    if (encoding === 'utf8' && filePath === '/key.pem') {
      return 'PRIVATE KEY';
    }

    throw new Error(`Unexpected readFile call for ${filePath}`);
  });

  const createPrivateKey = vi.fn((keyMaterial: string) => ({ keyMaterial }));
  const createSsl = vi.fn((certificate: Buffer) => ({ certificate }));
  const grpcClientCtor = vi.fn();
  const newPrivateKeySigner = vi.fn((privateKey: { keyMaterial: string }) => ({ privateKey }));
  const contract = {
    newProposal: vi.fn(),
    evaluateTransaction: vi.fn()
  };
  const activeNetwork = {
    getContract: vi.fn(() => contract)
  };
  const gateway = {
    getNetwork: vi.fn(() => activeNetwork),
    close: vi.fn()
  };
  const connect = vi.fn(() => gateway);

  return {
    readFile,
    createPrivateKey,
    createSsl,
    grpcClientCtor,
    newPrivateKeySigner,
    contract,
    activeNetwork,
    gateway,
    connect
  };
});

vi.mock('fs', () => ({
  promises: {
    readFile: mocks.readFile
  }
}));

vi.mock('crypto', () => ({
  createPrivateKey: mocks.createPrivateKey
}));

vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: mocks.createSsl
  },
  Client: mocks.grpcClientCtor
}));

vi.mock('@hyperledger/fabric-gateway', () => ({
  connect: mocks.connect,
  signers: {
    newPrivateKeySigner: mocks.newPrivateKeySigner
  }
}));

import { FabricDelegator } from './FabricDelegator.js';

function createDelegator() {
  return new FabricDelegator('/tls.pem', 'peer:7051', 'peer-host', 'roadwatch-channel', 'roadwatch-chaincode');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockReturnValue(mocks.gateway);
  mocks.activeNetwork.getContract.mockReturnValue(mocks.contract);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FabricDelegator', () => {
  it('initializes the gateway and contract', async () => {
    const delegator = createDelegator();

    await delegator.initializeSecureVaults('/cert.pem', '/key.pem');

    expect(mocks.readFile).toHaveBeenCalledWith('/cert.pem', 'utf8');
    expect(mocks.readFile).toHaveBeenCalledWith('/key.pem', 'utf8');
    expect(mocks.readFile).toHaveBeenCalledWith('/tls.pem');
    expect(mocks.createPrivateKey).toHaveBeenCalledWith('PRIVATE KEY');
    expect(mocks.createSsl).toHaveBeenCalledWith(Buffer.from('TLS CERTIFICATE'));
    expect(mocks.grpcClientCtor).toHaveBeenCalledWith('peer:7051', { certificate: Buffer.from('TLS CERTIFICATE') }, {
      'grpc.ssl_target_name_override': 'peer-host'
    });
    expect(mocks.newPrivateKeySigner).toHaveBeenCalledWith({ keyMaterial: 'PRIVATE KEY' });
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.any(Object),
        identity: { mspId: 'CitizenOrgMSP', credentials: Buffer.from('CERTIFICATE') }
      })
    );
    expect(mocks.activeNetwork.getContract).toHaveBeenCalledWith('roadwatch-chaincode');
  });

  it('submits complaints through the Fabric contract', async () => {
    const delegator = createDelegator();
    const proposal = { endorse: vi.fn() };
    const endorsed = { submit: vi.fn() };
    const committed = { getStatus: vi.fn() };

    proposal.endorse.mockResolvedValue(endorsed);
    endorsed.submit.mockResolvedValue(committed);
    committed.getStatus.mockResolvedValue({ successful: true, transactionId: 'tx-123' });
    mocks.contract.newProposal.mockReturnValue(proposal);

    await delegator.initializeSecureVaults('/cert.pem', '/key.pem');
    const transactionId = await delegator.submitCitizenComplaint(
      { userId: 'user-1' },
      {
        id: 'complaint-1',
        roadId: 'road-7',
        location: { latitude: 18.5, longitude: 73.8 },
        ipfsCid: 'cid-1',
        authorityOrg: 'authority-1',
        detailsHash: 'hash-1'
      }
    );

    expect(transactionId).toBe('tx-123');
    expect(mocks.contract.newProposal).toHaveBeenCalledWith('CreateComplaint', {
      arguments: [
        'complaint-1',
        'user-1',
        'road-7',
        JSON.stringify({ latitude: 18.5, longitude: 73.8 }),
        'cid-1',
        'authority-1',
        'hash-1'
      ]
    });
    expect(proposal.endorse).toHaveBeenCalledTimes(1);
    expect(endorsed.submit).toHaveBeenCalledTimes(1);
    expect(committed.getStatus).toHaveBeenCalledTimes(1);
  });

  it('reads complaint history from the blockchain', async () => {
    const delegator = createDelegator();
    mocks.contract.evaluateTransaction.mockResolvedValue(Buffer.from(JSON.stringify([{ value: { id: 'history-1' } }, { value: { id: 'history-2' } }])));

    await delegator.initializeSecureVaults('/cert.pem', '/key.pem');
    const complaint = await delegator.getComplaint('complaint-1');

    expect(mocks.contract.evaluateTransaction).toHaveBeenCalledWith('GetComplaintHistory', 'complaint-1');
    expect(complaint).toEqual({ id: 'history-2' });
  });

  it('updates complaint status through the Fabric contract', async () => {
    const delegator = createDelegator();
    const proposal = { endorse: vi.fn() };
    const endorsed = { submit: vi.fn() };
    const committed = { getStatus: vi.fn() };

    proposal.endorse.mockResolvedValue(endorsed);
    endorsed.submit.mockResolvedValue(committed);
    committed.getStatus.mockResolvedValue({ successful: true, transactionId: 'tx-456' });
    mocks.contract.newProposal.mockReturnValue(proposal);

    await delegator.initializeSecureVaults('/cert.pem', '/key.pem');
    const transactionId = await delegator.updateComplaintStatus('complaint-1', 'RESOLVED', 'authority-1', 'done');

    expect(transactionId).toBe('tx-456');
    expect(mocks.contract.newProposal).toHaveBeenCalledWith('UpdateComplaintStatus', {
      arguments: ['complaint-1', 'RESOLVED', 'authority-1']
    });
  });

  it('disconnects the gateway and makes health checks fail', async () => {
    const delegator = createDelegator();
    mocks.contract.evaluateTransaction.mockResolvedValue(Buffer.from('[]'));

    await delegator.initializeSecureVaults('/cert.pem', '/key.pem');
    expect(await delegator.healthCheck()).toBe(true);

    await delegator.disconnect();

    expect(mocks.gateway.close).toHaveBeenCalledTimes(1);
    expect(await delegator.healthCheck()).toBe(false);
  });

  it('returns false from healthCheck before initialization', async () => {
    const delegator = createDelegator();

    await expect(delegator.healthCheck()).resolves.toBe(false);
  });
});