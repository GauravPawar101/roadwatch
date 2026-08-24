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

  it('does not expose legacy service registry routes', async () => {
    const app = createApp();
    const registerResponse = await request(app)
      .post('/services/register')
      .send({ name: 'backend-api', address: 'http://127.0.0.1:4001' });

    expect(registerResponse.status).toBe(404);
  });
});
