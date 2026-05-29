import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postgresMock = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

const authMock = vi.hoisted(() => ({
  ensureAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next()
}));

const rateLimiterMock = vi.hoisted(() => ({
  rateLimiter: (_req: unknown, _res: unknown, next: () => void) => next()
}));

const complaintOutboxMock = vi.hoisted(() => ({
  enqueueComplaintSubmittedEvent: vi.fn()
}));

const kafkaMock = vi.hoisted(() => ({
  emitComplaintEvent: vi.fn()
}));

vi.mock('../../../apps/gateway-api/src/postgres.js', () => postgresMock);
vi.mock('../middleware/auth', () => authMock);
vi.mock('../middleware/rateLimiter', () => rateLimiterMock);
vi.mock('../services/complaintOutbox.js', () => complaintOutboxMock);
vi.mock('../services/kafka.js', () => kafkaMock);

import { analyzeComplaintText, summarizeRoadTextIntel } from '../../../packages/core/src/engines/complaintTextIntel.ts';
import complaintsRouter from './complaints.js';

const poolMock = postgresMock.pool;
const enqueueComplaintSubmittedEventMock = complaintOutboxMock.enqueueComplaintSubmittedEvent;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/complaints', complaintsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('complaint text intelligence', () => {
  it('detects urgent text in English and regional-language reports', () => {
    const english = analyzeComplaintText('Accident happened here. Truck fell and bleeding on the road.');
    expect(english.language).toBe('en');
    expect(english.recommendedSeverity).toBe(5);
    expect(english.sentimentLabel).toBe('negative');
    expect(english.signals).toEqual(expect.arrayContaining(['accident', 'truck-fell', 'bleeding']));

    const hindi = analyzeComplaintText('यहां दुर्घटना हुई है और ट्रक पलट गया है');
    expect(['hi', 'mr']).toContain(hindi.language);
    expect(hindi.recommendedSeverity).toBe(5);
    expect(hindi.signals).toEqual(expect.arrayContaining(['accident', 'truck-fell']));
  });

  it('flags a road segment when several weighted reports are negative', () => {
    const summary = summarizeRoadTextIntel([
      { ...analyzeComplaintText('The road is unsafe and blocked'), reportCount: 1 },
      { ...analyzeComplaintText('Very bad and dangerous stretch'), reportCount: 2 },
      { ...analyzeComplaintText('This route is fine'), reportCount: 1 }
    ]);

    expect(summary.totalReportCount).toBe(4);
    expect(summary.negativeReportCount).toBeGreaterThanOrEqual(2);
    expect(summary.priorityFlag).toBe(true);
    expect(summary.priorityScore).toBeGreaterThan(0);
  });
});

describe('complaints route', () => {
  it('raises severity from urgent text and stores text intel metadata', async () => {
    poolMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'road-1',
            authority_id: 'auth-1',
            geometry: { type: 'LineString', coordinates: [[77.1, 28.1], [77.2, 28.2]] },
            district_id: 'district-1',
            name: 'Main Road',
            metadata: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const txClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    };
    poolMock.connect.mockResolvedValue(txClient);

    const res = await request(createApp()).post('/complaints').send({
      roadId: 'road-1',
      description: 'Accident happened here. Truck fell and there is bleeding.',
      damageType: 'Pothole',
      severity: 2,
      lat: 28.15,
      lng: 77.15
    });

    expect(res.status).toBe(201);
    expect(res.body.complaint.severity).toBe(5);
    expect(res.body.complaint.textIntel.recommendedSeverity).toBe(5);

    const insertCall = txClient.query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO complaints'));
    expect(insertCall).toBeDefined();
    const insertParams = insertCall?.[1] as Array<any>;
    expect(insertParams[3]).toBe('Accident happened here. Truck fell and there is bleeding.');
    expect(insertParams[8]).toMatchObject({
      severity: 5,
      textIntel: expect.objectContaining({
        recommendedSeverity: 5,
        language: 'en'
      })
    });
    expect(enqueueComplaintSubmittedEventMock).toHaveBeenCalledTimes(1);
  });

  it('allows missing descriptions and falls back to a generated complaint description', async () => {
    poolMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'road-2',
            authority_id: 'auth-1',
            geometry: { type: 'LineString', coordinates: [[77.1, 28.1], [77.2, 28.2]] },
            district_id: 'district-1',
            name: 'Main Road',
            metadata: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const txClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    };
    poolMock.connect.mockResolvedValue(txClient);

    const res = await request(createApp()).post('/complaints').send({
      roadId: 'road-2',
      damageType: 'Pothole',
      severity: 3,
      lat: 28.15,
      lng: 77.15
    });

    expect(res.status).toBe(201);
    expect(res.body.complaint.description).toBe('Citizen report: Pothole');

    const insertCall = txClient.query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO complaints'));
    expect(insertCall).toBeDefined();
    const insertParams = insertCall?.[1] as Array<any>;
    expect(insertParams[3]).toBe('Citizen report: Pothole');
    expect(insertParams[8]).toMatchObject({
      severity: 3,
      textIntel: expect.objectContaining({
        hasText: false,
        recommendedSeverity: 0
      })
    });
  });
});