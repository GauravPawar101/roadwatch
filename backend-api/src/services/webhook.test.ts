import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postgresMock = vi.hoisted(() => ({
  pool: {
    query: vi.fn()
  }
}));

vi.mock('../../../apps/gateway-api/src/postgres.js', () => postgresMock);

import webhookRouter from './webhook.js';

const poolMock = postgresMock.pool;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fabric-state-change webhook', () => {
  it('creates a complaint and logs audit data for complaint-submitted events', async () => {
    poolMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(createApp()).post('/webhook/fabric-state-change').send({
      complaintId: 'complaint-1',
      type: 'complaint-submitted',
      district: 'district-1',
      zone: 'zone-1',
      description: 'road damage',
      lat: 18.5,
      lng: 73.8,
      metadata: { roadId: 'road-7', severity: 'high' },
      fabricTxId: 'tx-1',
      occurredAt: '2026-05-27T00:00:00.000Z'
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, complaintId: 'complaint-1', eventType: 'complaint-submitted', fabricTxId: 'tx-1' });
    expect(poolMock.query).toHaveBeenNthCalledWith(1, expect.stringContaining('SELECT id, status FROM complaints WHERE id = $1 LIMIT 1'), ['complaint-1']);
    expect(poolMock.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO complaints (id, district, zone, status, description'), expect.any(Array));
    expect(poolMock.query).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO audit_log'), expect.any(Array));
  });

  it('updates anchored complaints when a Fabric tx id arrives', async () => {
    poolMock.query
      .mockResolvedValueOnce({ rows: [{ id: 'complaint-1', status: 'FILED' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(createApp()).post('/webhook/fabric-state-change').send({
      complaintId: 'complaint-1',
      eventType: 'complaint-anchored',
      fabricTxId: 'tx-anchored',
      metadata: { roadId: 'road-7' }
    });

    expect(res.status).toBe(200);
    expect(poolMock.query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE complaints'), ['tx-anchored', 'complaint-1']);
  });

  it('updates complaint status for complaint-status-changed events', async () => {
    poolMock.query
      .mockResolvedValueOnce({ rows: [{ id: 'complaint-1', status: 'FILED' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(createApp()).post('/webhook/fabric-state-change').send({
      complaintId: 'complaint-1',
      eventType: 'complaint-status-changed',
      newStatus: 'RESOLVED'
    });

    expect(res.status).toBe(200);
    expect(poolMock.query).toHaveBeenNthCalledWith(2, 'UPDATE complaints SET status = $1, updated_at = NOW() WHERE id = $2', ['RESOLVED', 'complaint-1']);
  });

  it('returns 404 when a non-submission event targets an unknown complaint', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(createApp()).post('/webhook/fabric-state-change').send({
      complaintId: 'missing-complaint',
      eventType: 'complaint-anchored',
      fabricTxId: 'tx-1'
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Complaint not found' });
  });

  it('rejects invalid webhook payloads', async () => {
    const res = await request(createApp()).post('/webhook/fabric-state-change').send({
      complaintId: '',
      type: 'complaint-submitted'
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid webhook payload');
  });
});