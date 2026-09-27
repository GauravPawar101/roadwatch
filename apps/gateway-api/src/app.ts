import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { makeAsyncSafe } from '@roadwatch/core';
import { isDraining } from './graceful-shutdown.js';
import { getServiceGraph, getSystemHealth } from './health.js';
import { requireAuth } from './rbac.js';
import { addSseClient } from './realtime/sse.js';
import adminRouter from './routes/admin.js';
import agentRouter from './routes/agent.js';
import authRouter from './routes/auth.js';
import authorityRouter from './routes/authority.js';
import citizenRouter from './routes/citizen.js';
import complaintsRouter from './routes/complaints.js';
import contractorRouter from './routes/contractor.js';
import internalNotificationsRouter from './routes/internal-notifications.js';
import notificationsRouter from './routes/notifications.js';
import publicRouter from './routes/public.js';
import reportsRouter from './routes/reports.js';
import rtiRouter from './routes/rti.js';
import { acquireComplaintWriteAdmission } from './security/write-backpressure.js';
import { getAdmissionMetrics } from './security/admission-metrics.js';

/** Truthy in the same sense the config layer uses, so both agree on what "on" means. */
function truthyEnv(raw: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? '').trim());
}

export function createApp() {
  // Patched before any handler is registered so that every route and
  // middleware below is async-safe. Without this, Express 4 lets a rejected
  // promise from a handler escape: the client gets no response at all and the
  // process takes an unhandled rejection.
  const app = makeAsyncSafe(express());

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
  // Body parsing. Before any route: a malformed body has to be rejected here, and
  // the 404 handler below must not be reached first.
  app.use(express.json({ limit: '2mb' }));

  // Request logging.
  //
  // `morgan('dev')` wrote a formatted line to stdout for *every* request. At the
  // throughput this system is being aimed at that is not observability, it is the
  // workload: 100,000 log lines per second, each formatted and written on the
  // event loop, and each one a syscall contending with the socket writes for the
  // response itself. Measured on the paginated complaint list, morgan was among
  // the largest single consumers of CPU in the response path.
  //
  // It is therefore opt-in. LOG_REQUESTS=1 restores per-request logging for
  // development; in production the deployment is expected to sample, or to
  // collect access logs from the load balancer, which already sees every request
  // and is not on the request's critical path.
  if (truthyEnv(process.env.LOG_REQUESTS)) {
    app.use(morgan(process.env.LOG_FORMAT ?? 'dev'));
  }

  app.use(async (req, res, next) => {
    const isWriteRequest = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isComplaintPath = ['/citizen', '/authority', '/complaints'].some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`));

    if (!isWriteRequest || !isComplaintPath) {
      return next();
    }

    try {
      let userSub: string | undefined;
      const authHeader = req.headers.authorization;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        try {
          const payloadPart = authHeader.slice('Bearer '.length).split('.')[1];
          if (payloadPart) {
            const json = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { sub?: string };
            if (typeof json.sub === 'string' && json.sub.trim()) userSub = json.sub.trim();
          }
        } catch {
          // ignore malformed tokens; fall back to IP
        }
      }
      const principal = userSub || req.ip || 'unknown-ip';
      const routeScope = `gateway:${req.method}:${req.path.split('/')[1] ?? 'write'}`;

      // Both permits in one Redis command. Previously acquired as two separate
      // four-command sequences: six commands per write, and the increments were
      // not atomic, so concurrent requests could both pass an inflight check
      // that only one of them should have passed.
      const permit = await acquireComplaintWriteAdmission({ routeScope, principal });

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

  // Readiness. Reports 503 while draining, which is what makes a rolling deploy
  // stop sending traffic here before the process stops accepting it. A plain
  // `200 ok` would leave the load balancer writing to a closing instance for the
  // whole grace period.
  app.get('/health', (_req, res) => {
    if (isDraining()) {
      res.status(503).json({ status: 'draining' });
      return;
    }
    res.json({ status: 'ok' });
  });

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

  // Prometheus-friendly admission / outbox gauges (text exposition)
  app.get('/metrics/admission', async (_req, res) => {
    try {
      const metrics = await getAdmissionMetrics();
      res.type('text/plain').send(metrics);
    } catch (error) {
      res.status(503).type('text/plain').send(`# error ${error instanceof Error ? error.message : 'unknown'}\n`);
    }
  });

  app.use('/auth', authRouter);
  // Mounting public router under /public to serve citizen dashboard + onboarding endpoints without authentication
  app.use('/public', publicRouter);
  // Citizen actions (authenticated as CITIZEN)
  app.use('/citizen', citizenRouter);
  // Complaints management
  app.use('/complaints', complaintsRouter);
  // Contractor actions
  app.use('/contractor', contractorRouter);
  // Lightweight agent endpoint (LLM inference happens server-side)
  app.use('/public/agent', agentRouter);
  // RTI workflow is token-tracked (separate from complaints)
  app.use('/rti', rtiRouter);
  app.use('/admin', adminRouter);
  app.use('/authority', authorityRouter);
  app.use('/reports', reportsRouter);
  app.use('/notifications', notificationsRouter);
  // Internal service endpoints (protected by shared token locally; Istio in k8s)
  app.use('/internal/notifications', internalNotificationsRouter);

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

  // Unmatched routes. Registered before the error handler so a 404 is not
  // swallowed by it.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Terminal error handler. This must stay last, and must keep its four
  // parameters: Express only treats a layer as error middleware when
  // `fn.length === 4`.
  //
  // It also gives the gateway something it previously lacked entirely — before
  // this, a synchronous throw produced Express's default HTML error page and an
  // async throw produced no response whatsoever.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      // Too late to change the status; hand off so Express can destroy the
      // socket rather than leave the client hanging.
      next(err);
      return;
    }

    const status = typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
    const message = err instanceof Error ? err.message : 'Internal server error';

    if (status >= 500) {
      console.error('[gateway-api] unhandled request error:', err);
    }

    res.status(status).json({ error: status >= 500 ? 'Internal server error' : message });
  });

  return app;
}
