import cors from 'cors';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import analyticsRouter from './routes/analytics.js';
import complaintsRouter from './routes/complaints.js';
import { initializeImageRoutes } from './routes/image-submissions.js';
import { errorHandler } from './services/errorHandler.js';
import webhookRouter from './services/webhook.js';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: resolve(workspaceRoot, 'apps/gateway-api/.env'), override: true });

// Ensure Cassandra env defaults for local development
process.env.CASSANDRA_CONTACT_POINTS = process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042';
process.env.CASSANDRA_KEYSPACE = process.env.CASSANDRA_KEYSPACE || 'roadwatch';
process.env.CASSANDRA_LOCAL_DC = process.env.CASSANDRA_LOCAL_DC || 'datacenter1';

const { pool } = await import('../../apps/gateway-api/src/db.js');
const { execute } = await import('../../apps/gateway-api/src/cassandra.js');

const app = express();
const port = Number(process.env.BACKEND_PORT ?? 4001);

// Configure CORS: allow origins from environment or sensible defaults
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser or same-origin requests (no origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/health/db', async (_req, res) => {
  try {
    await execute('SELECT release_version FROM system.local', [], { prepare: true });
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.use(initializeImageRoutes(pool));
app.use('/complaints', complaintsRouter);
app.use('/webhooks', webhookRouter);
app.use('/analytics', analyticsRouter);
app.use(errorHandler);

app.listen(port, '127.0.0.1', () => {
  console.log(`[backend-api] listening on http://127.0.0.1:${port}`);
});