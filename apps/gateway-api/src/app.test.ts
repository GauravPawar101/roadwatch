import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('gateway-api app', () => {
  it('GET /health returns ok', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('registers and authorizes services', async () => {
    const previousRegistrySecret = process.env.SERVICE_REGISTRY_SECRET;
    const previousAuthSecret = process.env.SERVICE_AUTH_SECRET;

    try {
      process.env.SERVICE_REGISTRY_SECRET = 'registry-secret';
      process.env.SERVICE_AUTH_SECRET = 'service-secret';

      const app = createApp();
      const registerResponse = await request(app)
        .post('/services/register')
        .set('x-service-registry-secret', 'registry-secret')
        .send({
          name: 'backend-api',
          address: 'http://127.0.0.1:4001',
          healthUrl: 'http://127.0.0.1:4001/health'
        });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.service.name).toBe('backend-api');
      expect(typeof registerResponse.body.registrationToken).toBe('string');

      const tokenResponse = await request(app)
        .post('/services/backend-api/token')
        .set('Authorization', `Bearer ${registerResponse.body.registrationToken}`)
        .send({ ttlSeconds: 120, method: 'POST', path: '/analytics/collect' });

      expect(tokenResponse.status).toBe(200);
      expect(tokenResponse.body.service.name).toBe('backend-api');
      expect(typeof tokenResponse.body.token).toBe('string');
    } finally {
      process.env.SERVICE_REGISTRY_SECRET = previousRegistrySecret;
      process.env.SERVICE_AUTH_SECRET = previousAuthSecret;
    }
  });
});
