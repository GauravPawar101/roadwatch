import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { isAsyncSafe } from '@roadwatch/core';
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

  it('answers unknown routes with a JSON 404 rather than Express HTML', async () => {
    const app = createApp();
    const res = await request(app).get('/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  /**
   * Regression guard for the error middleware the gateway previously lacked.
   * `express.json()` rejects a malformed body before any route runs, so this
   * exercises the terminal handler with a client-error status and no database
   * involvement. It must answer with JSON rather than Express's default HTML.
   */
  it('answers a malformed JSON body with a JSON 400 from the error handler', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/auth/otp/request')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');

    expect(res.status).toBe(400);
    expect(res.type).toBe('application/json');
    expect(res.body).toHaveProperty('error');
  });

  it('rejects a token whose sub is not a UUID, without touching the database', async () => {
    const app = createApp();
    const { default: jwt } = await import('jsonwebtoken');
    const { getEnv } = await import('./env.js');
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { sub: 'not-a-uuid', role: 'CE', districts: ['ALL'], zones: ['ALL'], iat: now, exp: now + 3600 },
      getEnv().ACCESS_SECRET,
    );

    const res = await request(app)
      .get('/authority/complaints')
      .set('Authorization', `Bearer ${token}`);

    // Previously this reached Postgres, aborted the transaction, and the
    // unhandled rejection terminated the process.
    expect(res.status).toBe(401);
  });
});

describe('gateway route modules are async-safe', () => {
  /**
   * Express 4 does not catch rejections from async handlers, so every router
   * must come from the async-safe factory. Scanning the directory (rather than
   * listing files by hand) means a newly added route file that reaches for
   * plain `express.Router()` fails here instead of silently reintroducing hung
   * requests in production.
   */
  const routesDir = fileURLToPath(new URL('./routes/', import.meta.url));
  const routeFiles = readdirSync(routesDir)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();

  it('finds the route modules', () => {
    expect(routeFiles.length).toBeGreaterThan(5);
  });

  it.each(routeFiles.map(name => [name]))('routes/%s uses the async-safe router', async name => {
    const href = pathToFileURL(join(routesDir, name)).href;
    const loaded = (await import(/* @vite-ignore */ href)) as { default?: unknown };
    const router = loaded.default ?? loaded;
    expect(isAsyncSafe(router)).toBe(true);
  });
});
