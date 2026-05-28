import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { acquireDistributedBackpressurePermit } from '@roadwatch/redis';
import { getServiceGraph, getSystemHealth } from './health.js';
import { requireAuth } from './rbac.js';
import { addSseClient } from './realtime/sse.js';
import adminRouter from './routes/admin.js';
import agentRouter from './routes/agent.js';
import authRouter from './routes/auth.js';
import authorityRouter from './routes/authority.js';
import citizenRouter from './routes/citizen.js';
import complaintsRouter from './routes/complaints.js';
import notificationsRouter from './routes/notifications.js';
import internalNotificationsRouter from './routes/internal-notifications.js';
import proxyRouter from './routes/proxy.js';
import publicRouter from './routes/public.js';
import reportsRouter from './routes/reports.js';
import rtiRouter from './routes/rti.js';
import servicesRouter from './routes/services.js';

export function createApp() {
  const app = express();

  // Configure CORS: allow origins from environment or sensible defaults
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  app.use(async (req, res, next) => {
    const isWriteRequest = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isComplaintPath = ['/citizen', '/authority', '/complaints'].some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`));

    if (!isWriteRequest || !isComplaintPath) {
      return next();
    }

    try {
      const permit = await acquireDistributedBackpressurePermit({
        scope: `gateway:${req.method}:${req.path.split('/')[1] ?? 'write'}`,
        principal: req.ip ?? 'unknown-ip',
        maxRequestsPerWindow: 120,
        windowSeconds: 60,
        maxInflight: 24,
        inflightTtlSeconds: 120
      });

      res.on('finish', () => {
        void permit.release();
      });

      return next();
    } catch (error) {
      const statusCode = typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 503;
      const retryAfterSeconds = typeof (error as any)?.retryAfterSeconds === 'number' ? (error as any).retryAfterSeconds : 5;
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(statusCode).json({
        error: 'Write admission temporarily saturated',
        retryAfterSeconds
      });
    }
  });

  // Basic health check
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Comprehensive health check with service status
  app.get('/health/status', async (_req, res) => {
    try {
      const healthReport = await getSystemHealth();
      const statusCode = healthReport.overallStatus === 'healthy' ? 200 : 503;
      res.status(statusCode).json(healthReport);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Service dependency graph
  app.get('/health/services', (_req, res) => {
    res.json({
      services: getServiceGraph(),
      timestamp: new Date()
    });
  });

  app.use('/auth', authRouter);
  // Mounting public router under /public to serve citizen dashboard + onboarding endpoints without authentication
  app.use('/public', publicRouter);
  // Citizen actions (authenticated as CITIZEN)
  app.use('/citizen', citizenRouter);
  // Complaints management
  app.use('/complaints', complaintsRouter);
  // Lightweight agent endpoint (LLM inference happens server-side)
  app.use('/public/agent', agentRouter);
  // RTI workflow is token-tracked (separate from complaints)
  app.use('/rti', rtiRouter);
  app.use('/admin', adminRouter);
  app.use('/authority', authorityRouter);
  app.use('/reports', reportsRouter);
  app.use('/notifications', notificationsRouter);
  // Internal service endpoints (protected by shared token)
  app.use('/internal/notifications', internalNotificationsRouter);
  app.use('/services', servicesRouter);
  app.use('/proxy', proxyRouter);

  // Real-time SSE stream
  app.get('/events', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`event: ready\n`);
    res.write(`data: {"ok":true}\n\n`);

    const cleanup = addSseClient({ res, user: (req as any).user });
    req.on('close', () => {
      cleanup();
      res.end();
    });
  });

  return app;
}
