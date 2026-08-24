import cors from 'cors';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express-serve-static-core';
import morgan from 'morgan';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '@roadwatch/core';
import { auditAccess } from './middleware/rbac.js';
import { permissiveSidecarAuth } from './middleware/sidecarFallback.js';
import analyticsRouter from './routes/analytics.js';
import complaintsRouter from './routes/complaints.js';
import { startComplaintEventRelay } from './services/complaintOutbox.js';
import { errorHandler } from './services/errorHandler.js';
import webhookRouter from './services/webhook.js';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: resolve(workspaceRoot, 'apps/gateway-api/.env'), override: true });

const app = express();
const port = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 4001);
const host = process.env.HOST ?? '0.0.0.0';


const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-User-ID', 'X-User-Role', 'X-Service-Token']
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
app.get('/health/db', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.use('/analytics', permissiveSidecarAuth, auditAccess, analyticsRouter);
app.use('/complaints', permissiveSidecarAuth, auditAccess, complaintsRouter);
app.use('/webhook', webhookRouter);

try {
  const imageRoutes = await import('./routes/image-submissions.js');
  if (typeof imageRoutes.initializeImageRoutes === 'function') {
    app.use('/image-submissions', permissiveSidecarAuth, auditAccess, imageRoutes.initializeImageRoutes(pool));
  }
} catch (error) {
  console.warn('[backend-api] image-submission routes disabled:', error instanceof Error ? error.message : String(error));
}

app.use(errorHandler);

void startComplaintEventRelay().catch(error => {
  console.error('[backend-api] complaint outbox relay failed to start:', error instanceof Error ? error.message : String(error));
});

app.listen(port, host, () => {
  console.log(`[backend-api] listening on http://${host}:${port}`);
});
