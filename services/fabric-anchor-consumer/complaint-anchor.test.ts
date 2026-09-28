import { describe, expect, it, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The deployed chaincode contract.
 *
 * These tests exist because the anchor consumer called four functions that
 * contract.js never defined, so no Fabric transaction had ever completed on
 * the accountability path. The Go test next to the contract
 * (complaint_anchor_test.go) exercises complaint_anchor.go, a different
 * implementation, and cannot catch that.
 *
 * contract.js is CommonJS and requires fabric-contract-api, so it is loaded
 * through createRequire rather than imported.
 */
const require = createRequire(import.meta.url);
const ComplaintAnchorContract = require('../../fabric/chaincode/complaint-anchor/contract.js');

type HistoryEntry = {
  txId: string;
  timestamp: string;
  isDelete: boolean;
  value: string;
};

/** Minimal in-memory Fabric stub: enough surface for the contract's use of it. */
function makeStub() {
  const state = new Map<string, Buffer>();
  const events: Array<{ name: string; payload: any }> = [];
  const history = new Map<string, HistoryEntry[]>();

  return {
    state,
    events,
    createCompositeKey(objectType: string, keys: string[]) {
      return [objectType, ...keys].join('\u0000');
    },
    async getState(key: string) {
      return state.get(key) ?? null;
    },
    async putState(key: string, value: Buffer) {
      const previous = state.get(key);
      state.set(key, value);
      if (!history.has(key)) history.set(key, []);
      history.get(key)!.push({
        txId: `tx-${history.get(key)!.length + 1}`,
        timestamp: '2026-09-28T00:00:00Z',
        isDelete: false,
        value: value.toString(),
      });
      void previous;
    },
    async setEvent(name: string, payload: Buffer) {
      events.push({ name, payload: JSON.parse(payload.toString()) });
    },
    async getTxTimestamp() {
      return { seconds: { low: 1_757_000_000, high: 0, toNumber: () => 1_757_000_000 } };
    },
    async getHistoryForKey(key: string) {
      const entries = history.get(key) ?? [];
      let i = 0;
      return {
        async next() {
          const entry = entries[i++];
          return {
            value: entry
              ? { txId: entry.txId, timestamp: entry.timestamp, isDelete: entry.isDelete, value: Buffer.from(entry.value) }
              : undefined,
            done: i >= entries.length,
          };
        },
        async close() {},
      };
    },
    read(key: string) {
      const raw = state.get(key);
      return raw ? JSON.parse(raw.toString()) : null;
    },
  };
}

function makeCtx(stub: ReturnType<typeof makeStub>, msp = 'NHAIMSP') {
  return {
    stub,
    clientIdentity: { getMSPID: () => msp },
  } as any;
}

const COMPLAINT_ID = 'c-0001';
const ROAD_ID = 'NH-48';

describe('deployed complaint-anchor contract', () => {
  let stub: ReturnType<typeof makeStub>;
  let contract: any;
  let ctx: any;

  beforeEach(() => {
    stub = makeStub();
    contract = new ComplaintAnchorContract();
    ctx = makeCtx(stub);
  });

  const key = () => stub.createCompositeKey('COMPLAINT', [COMPLAINT_ID]);

  const submit = () =>
    contract.UpsertComplaintSubmission(
      ctx,
      COMPLAINT_ID,
      'citizen-1',
      ROAD_ID,
      JSON.stringify({ lat: 28.6, lng: 77.2 }),
      'cid-initial',
      'NHAI-ZONE-1',
      'sha-initial',
      'evt-1',
      '0',
      '1',
    );

  describe('UpsertComplaintSubmission', () => {
    it('writes an accountability record for a new complaint', async () => {
      await submit();
      const record = stub.read(key());
      expect(record).toMatchObject({
        ID: COMPLAINT_ID,
        RoadID: ROAD_ID,
        DetailsHash: 'sha-initial',
        ReportCount: 1,
        Status: 'FILED',
        AuthorityOrg: 'NHAI-ZONE-1',
        Merged: false,
      });
    });

    it('keeps citizen identity and location off the ledger', async () => {
      await submit();
      const raw = stub.read(key());
      const serialised = JSON.stringify(raw);
      expect(serialised).not.toContain('citizen-1');
      expect(serialised).not.toContain('28.6');
      expect(serialised).not.toContain('cid-initial');
    });

    it('bumps the report count when a duplicate is merged', async () => {
      await submit();
      await contract.UpsertComplaintSubmission(
        ctx, COMPLAINT_ID, 'citizen-2', ROAD_ID, '{}', '', 'NHAI-ZONE-1', 'sha-2', 'evt-2', '1', '2',
      );
      expect(stub.read(key()).ReportCount).toBe(2);
    });

    it('is a no-op when the same event is redelivered', async () => {
      await submit();
      const before = stub.events.length;
      // Kafka is at-least-once, so a rebalance can replay the same event.
      await submit();
      expect(stub.read(key()).ReportCount).toBe(1);
      expect(stub.events.length).toBe(before);
    });

    it('rejects an unauthorised MSP', async () => {
      const untrusted = makeCtx(makeStub(), 'CitizenOrgMSP');
      await expect(
        contract.UpsertComplaintSubmission(
          untrusted, COMPLAINT_ID, 'c', ROAD_ID, '{}', '', 'org', 'h', 'evt-x', '0', '1',
        ),
      ).rejects.toThrow(/unauthorized MSP: CitizenOrgMSP/);
    });

    it('requires a roadId', async () => {
      await expect(
        contract.UpsertComplaintSubmission(
          ctx, COMPLAINT_ID, 'c', '', '{}', '', 'org', 'h', 'evt-y', '0', '1',
        ),
      ).rejects.toThrow(/roadId required/);
    });
  });

  describe('UpdateComplaintStatus', () => {
    it('transitions a known complaint and reports the previous status', async () => {
      await submit();
      await contract.UpdateComplaintStatus(ctx, COMPLAINT_ID, 'IN_PROGRESS', 'ee-9', 'evt-s1');
      expect(stub.read(key()).Status).toBe('IN_PROGRESS');
      const event = stub.events.find(e => e.name === 'ComplaintStatusUpdated')!;
      expect(event.payload).toMatchObject({
        complaintId: COMPLAINT_ID,
        fromStatus: 'FILED',
        toStatus: 'IN_PROGRESS',
        officialEmployeeId: 'ee-9',
      });
    });

    it('does not write the acting employee to the world state', async () => {
      await submit();
      await contract.UpdateComplaintStatus(ctx, COMPLAINT_ID, 'IN_PROGRESS', 'ee-9', 'evt-s1');
      expect(JSON.stringify(stub.read(key()))).not.toContain('ee-9');
    });

    it('accepts a status outside the original ten without a code change', async () => {
      await submit();
      await expect(
        contract.UpdateComplaintStatus(ctx, COMPLAINT_ID, 'AWAITING_COURT_SUMMONS', 'ee-9', 'evt-new'),
      ).resolves.toBeUndefined();
      expect(stub.read(key()).Status).toBe('AWAITING_COURT_SUMMONS');
    });

    it('rejects a malformed status', async () => {
      await submit();
      for (const bad of ['', 'in progress', 'DROP TABLE', 'x', null]) {
        await expect(
          contract.UpdateComplaintStatus(ctx, COMPLAINT_ID, bad, 'ee-9', `evt-bad-${String(bad)}`),
        ).rejects.toThrow(/invalid status value/);
      }
      expect(stub.read(key()).Status).toBe('FILED');
    });

    it('fails for a complaint that is not on the ledger', async () => {
      await expect(
        contract.UpdateComplaintStatus(ctx, 'missing', 'IN_PROGRESS', 'ee-9', 'evt-s2'),
      ).rejects.toThrow(/complaint not found on ledger/);
    });

    it('is a no-op when the event is redelivered', async () => {
      await submit();
      await contract.UpdateComplaintStatus(ctx, COMPLAINT_ID, 'IN_PROGRESS', 'ee-9', 'evt-s1');
      await contract.UpdateComplaintStatus(ctx, COMPLAINT_ID, 'ESCALATED', 'ee-9', 'evt-s1');
      expect(stub.read(key()).Status).toBe('IN_PROGRESS');
    });
  });

  describe('ResolveComplaint', () => {
    it('marks the complaint resolved and attributes the resolution', async () => {
      await submit();
      await contract.ResolveComplaint(ctx, COMPLAINT_ID, 'cid-resolution', 'ee-9');
      const record = stub.read(key());
      expect(record.Status).toBe('RESOLVED');
      expect(record.ResolutionIPFSCid).toBe('cid-resolution');
      const event = stub.events.find(e => e.name === 'ComplaintResolved')!;
      expect(event.payload).toMatchObject({ complaintId: COMPLAINT_ID, resolvedBy: 'ee-9' });
    });

    it('fails for an unknown complaint', async () => {
      await expect(contract.ResolveComplaint(ctx, 'missing', 'cid', 'ee-9')).rejects.toThrow(
        /complaint not found on ledger/,
      );
    });
  });

  describe('GetComplaintHistory', () => {
    it('returns every write to the complaint in order', async () => {
      await submit();
      await contract.UpdateComplaintStatus(ctx, COMPLAINT_ID, 'IN_PROGRESS', 'ee-9', 'evt-s1');
      await contract.ResolveComplaint(ctx, COMPLAINT_ID, 'cid-resolution', 'ee-9');

      const history = await contract.GetComplaintHistory(ctx, COMPLAINT_ID);
      expect(history).toHaveLength(3);
      expect(history[0].value.Status).toBe('FILED');
      expect(history[1].value.Status).toBe('IN_PROGRESS');
      expect(history[2].value.Status).toBe('RESOLVED');
      for (const entry of history) {
        expect(typeof entry.txId).toBe('string');
        expect(typeof entry.timestamp).toBe('string');
        expect(entry.isDelete).toBe(false);
      }
    });

    it('is empty for a complaint that was never anchored', async () => {
      await expect(contract.GetComplaintHistory(ctx, 'missing')).resolves.toEqual([]);
    });
  });

  it('exposes every function the anchor consumer invokes', () => {
    for (const fn of [
      'UpsertComplaintSubmission',
      'UpdateComplaintStatus',
      'ResolveComplaint',
      'GetComplaintHistory',
      'SubmitMerkleRoot',
    ]) {
      expect(typeof contract[fn]).toBe('function');
    }
  });
});
