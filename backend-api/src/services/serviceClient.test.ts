import express from 'express';
import http from 'http';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { callServiceThroughGateway } from './serviceClient.js';

let gatewayServer: http.Server;
let targetServer: http.Server;
let gatewayUrl: string;
let targetUrl: string;

beforeAll(async () => {
  // start target service
  const targetApp = express();
  targetApp.use(express.json());
  targetApp.post('/do-something', (req, res) => {
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

  gw.get('/services/:serviceName', (req, res) => {
    const auth = req.header('authorization') ?? '';
    if (auth !== 'Bearer reg-token') return res.status(401).json({ error: 'missing reg token' });
    const serviceName = req.params.serviceName;
    return res.json({ service: { name: serviceName, address: targetUrl } });
  });

  gw.post('/services/:serviceName/token', (req, res) => {
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
