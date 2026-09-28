import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postgresMock = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

const kafkaMock = vi.hoisted(() => ({
  emitComplaintEvent: vi.fn()
}));

// complaintOutbox.ts imports `pool` from @roadwatch/core. The previous mock
// targeted apps/gateway-api/src/postgres.js, a path this module never imports,
// so the real pg pool was used and these tests hit a live database.
vi.mock('@roadwatch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roadwatch/core')>();
  return { ...actual, pool: postgresMock.pool };
});
vi.mock('./kafka.js', () => kafkaMock);

import { drainComplaintEventOutbox, enqueueComplaintSubmittedEvent, startComplaintEventRelay } from './complaintOutbox.js';

const poolMock = postgresMock.pool;
const emitComplaintEventMock = kafkaMock.emitComplaintEvent;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeTransactionClient(rows: Array<Record<string, unknown>>) {
  const query = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce(undefined);
  const release = vi.fn();
  return { query, release };
}

describe('complaintOutbox', () => {
  it('enqueues submitted complaint events with the expected payload', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query: clientQuery };

    await enqueueComplaintSubmittedEvent(client, {
      type: 'complaint-submitted',
      idempotencyKey: 'complaint:1:submitted',
      occurredAt: '2026-05-27T00:00:00.000Z',
      version: 1,
      complaintId: 'complaint-1',
      district: 'district-1',
      zone: 'zone-1',
      lat: 18.5,
      lng: 73.8,
      description: 'pothole'
    });

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO complaint_event_outbox'),
      [
        'complaint-submitted',
        'complaint-1',
        JSON.stringify({
          type: 'complaint-submitted',
          idempotencyKey: 'complaint:1:submitted',
          occurredAt: '2026-05-27T00:00:00.000Z',
          version: 1,
          complaintId: 'complaint-1',
          district: 'district-1',
          zone: 'zone-1',
          lat: 18.5,
          lng: 73.8,
          description: 'pothole'
        })
      ]
    );
  });

  it('drains pending rows and marks them sent', async () => {
    const transactionClient = makeTransactionClient([
      {
        id: 'row-1',
        topic: 'complaint-submitted',
        message_key: 'complaint-1',
        payload: { complaintId: 'complaint-1' },
        attempts: 0
      }
    ]);
    poolMock.connect.mockResolvedValue(transactionClient);
    poolMock.query.mockResolvedValue({ rows: [] });
    emitComplaintEventMock.mockResolvedValue(undefined);

    const processed = await drainComplaintEventOutbox(10);

    expect(processed).toBe(1);
    expect(emitComplaintEventMock).toHaveBeenCalledWith(
      { complaintId: 'complaint-1' },
      'complaint-submitted',
      { key: 'complaint-1' }
    );
    expect(poolMock.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'SENT'"), ['row-1']);
    expect(transactionClient.release).toHaveBeenCalledTimes(1);
  });

  it('marks a row failed when publishing throws', async () => {
    const transactionClient = makeTransactionClient([
      {
        id: 'row-1',
        topic: 'complaint-submitted',
        message_key: 'complaint-1',
        payload: { complaintId: 'complaint-1' },
        attempts: 3
      }
    ]);
    poolMock.connect.mockResolvedValue(transactionClient);
    poolMock.query.mockResolvedValue({ rows: [] });
    emitComplaintEventMock.mockRejectedValue(new Error('kafka down'));

    const processed = await drainComplaintEventOutbox(10);

    expect(processed).toBe(0);
    expect(poolMock.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE complaint_event_outbox'),
      ['row-1', 3, 'kafka down', 15]
    );
  });

  it('starts the relay without runtime DDL and returns a stop function', async () => {
    const transactionClient = makeTransactionClient([]);
    poolMock.connect.mockResolvedValue(transactionClient);
    poolMock.query.mockResolvedValue({ rows: [] });
    emitComplaintEventMock.mockResolvedValue(undefined);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(123 as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);

    const stop = await startComplaintEventRelay();

    // DDL is centralized in docker/postgres/init.sql, so the relay must NOT issue
    // CREATE TABLE at runtime — assert the table is never created here.
    const ddlCalls = poolMock.query.mock.calls.filter((call) =>
      /CREATE\s+TABLE/i.test(String(call[0]))
    );
    expect(ddlCalls).toEqual([]);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

    await stop();

    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
  });
});