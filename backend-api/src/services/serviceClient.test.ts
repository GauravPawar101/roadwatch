import express from 'express';
import http from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { callServiceThroughGateway, requestServiceToken, resolveServiceAddress } from './serviceClient.js';

let gatewayServer: http.Server;
let targetServer: http.Server;
let gatewayUrl: string;
let targetUrl: string;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeAll(async () => {
  // start target service
  const targetApp = express();
  targetApp.use(express.json());
  targetApp.post('/do-something', (req: any, res: any) => {
    const auth = req.header('authorization') ?? '';
    if (auth !== 'Bearer service-token-abc') return res.status(401).json({ error: 'bad token' });
    return res.json({ ok: true, received: req.body });
  });

  targetServer = targetApp.listen(0);
  await new Promise<void>((r) => targetServer.once('listening', r));
  const targetPort = (targetServer.address() as any).port;
  targetUrl = `http://127.0.0.1:${targetPort}`;

  // start gateway mock
  const gw = express();
  gw.use(express.json());

  gw.get('/services/:serviceName', (req: any, res: any) => {
    const auth = req.header('authorization') ?? '';
    if (auth !== 'Bearer reg-token') return res.status(401).json({ error: 'missing reg token' });
    const serviceName = req.params.serviceName;
    return res.json({ service: { name: serviceName, address: targetUrl } });
  });

  gw.post('/services/:serviceName/token', (req: any, res: any) => {
    const auth = req.header('authorization') ?? '';
    if (auth !== 'Bearer reg-token') return res.status(401).json({ error: 'missing reg token' });
    return res.json({ service: { name: req.params.serviceName, address: targetUrl }, token: 'service-token-abc' });
  });

  gatewayServer = gw.listen(0);
  await new Promise<void>((r) => gatewayServer.once('listening', r));
  const gatewayPort = (gatewayServer.address() as any).port;
  gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
});

afterAll(async () => {
  await new Promise<void>((r) => gatewayServer.close(() => r()));
  await new Promise<void>((r) => targetServer.close(() => r()));
});

test('resolve -> token -> call flow', async () => {
  const res = await callServiceThroughGateway(gatewayUrl, 'reg-token', 'target-service', {
    method: 'POST',
    path: '/do-something',
    headers: { 'Content-Type': 'application/json' },
    body: { hello: 'world' }
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ ok: true, received: { hello: 'world' } });
});

describe('serviceClient helpers', () => {
  test('resolveServiceAddress trims the gateway URL and returns the service payload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://gateway.example/services/alpha%20beta');
      expect(init).toMatchObject({
        method: 'GET',
        headers: {
          Authorization: 'Bearer reg-token'
        }
      });

      return new Response(JSON.stringify({ service: { name: 'alpha beta', address: 'http://service.example' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const service = await resolveServiceAddress('http://gateway.example/', 'alpha beta', 'reg-token');

    expect(service).toEqual({ name: 'alpha beta', address: 'http://service.example' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('requestServiceToken posts method and path details', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://gateway.example/services/alpha/token');
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          Authorization: 'Bearer reg-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ method: 'POST', path: '/submit', ttlSeconds: 45 })
      });

      return new Response(JSON.stringify({ service: { name: 'alpha', address: 'http://service.example' }, token: 'service-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const response = await requestServiceToken('http://gateway.example/', 'reg-token', 'alpha', {
      method: 'POST',
      path: '/submit',
      ttlSeconds: 45
    });

    expect(response).toEqual({
      service: { name: 'alpha', address: 'http://service.example' },
      token: 'service-token'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('resolveServiceAddress surfaces gateway errors', async () => {
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await expect(resolveServiceAddress('http://gateway.example', 'alpha', 'reg-token')).rejects.toThrow(
      'resolveServiceAddress failed (404): missing'
    );
  });
});
