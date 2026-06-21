import cors from 'cors';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarAuthClient } from '@roadwatch/sidecar-auth';
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
const port = Number(process.env.BACKEND_PORT ?? 4001);
const serviceName = process.env.SERVICE_NAME ?? 'backend-api';
const serviceAddress = process.env.SERVICE_URL ?? `http://127.0.0.1:${port}`;
const gatewayUrl = process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100';

// Initialize sidecar auth client
const sidecarClient = new SidecarAuthClient(gatewayUrl, serviceName);

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
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Apply sidecar authentication to all routes except health checks
app.use('/analytics', permissiveSidecarAuth, auditAccess, analyticsRouter);
app.use('/complaints', permissiveSidecarAuth, auditAccess, complaintsRouter);
// Webhooks are called by external systems (fabric state change events).
// Expose the webhook endpoint without sidecar auth so external callers can POST.
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

// Register service with gateway on startup
async function registerWithGateway() {
  try {
    const result = await sidecarClient.registerService({
      name: serviceName,
      address: serviceAddress,
      healthUrl: `${serviceAddress}/health`,
      description: 'Backend API service for Roadwatch',
      metadata: {
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      }
    });
    
    console.log(`✅ Service registered with gateway:`, result.service);
    return result;
  } catch (error) {
    console.error('❌ Failed to register with gateway:', error);
    throw error;
  }
}

app.listen(port, '127.0.0.1', async () => {
  console.log(`[backend-api] listening on http://127.0.0.1:${port}`);
  
  // Register with gateway
  try {
    const reg = await registerWithGateway();
    // Sanity check: ensure the registered name matches the SERVICE_NAME env
    const expectedName = (process.env.SERVICE_NAME || serviceName).trim().toLowerCase();
    const registeredName = String(reg.service?.name || '').trim().toLowerCase();
    if (expectedName !== registeredName) {
      console.warn('[startup] SERVICE_NAME mismatch:');
      console.warn(`  - backend SERVICE_NAME env: "${process.env.SERVICE_NAME || serviceName}"`);
      console.warn(`  - gateway registered name: "${reg.service?.name}"`);
      console.warn('  Service access tokens are issued with audience=registered name.');
      console.warn('  If these do not match, service-to-service tokens may be rejected by the backend.');
      console.warn('  Recommended actions:');
      console.warn('    1) Set SERVICE_NAME in backend to the registered name, or');
      console.warn('    2) Re-register the service in the gateway using the desired SERVICE_NAME.');
    }
  } catch (error) {
    console.error('Service registration failed, but continuing...');
  }
});