import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { requireAuth } from './rbac.js';
import { addSseClient } from './realtime/sse.js';
import adminRouter from './routes/admin.js';
import agentRouter from './routes/agent.js';
import authRouter from './routes/auth.js';
import authorityRouter from './routes/authority.js';
import citizenRouter from './routes/citizen.js';
import notificationsRouter from './routes/notifications.js';
import publicRouter from './routes/public.js';
import reportsRouter from './routes/reports.js';
import rtiRouter from './routes/rti.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/auth', authRouter);
  // Mounting public router under /public to serve citizen dashboard + onboarding endpoints without authentication
  app.use('/public', publicRouter);
  // Citizen actions (authenticated as CITIZEN)
  app.use('/citizen', citizenRouter);
  // Lightweight agent endpoint (LLM inference happens server-side)
  app.use('/public/agent', agentRouter);
  // RTI workflow is token-tracked (separate from complaints)
  app.use('/rti', rtiRouter);
  app.use('/admin', adminRouter);
  app.use('/authority', authorityRouter);
  app.use('/reports', reportsRouter);
  app.use('/notifications', notificationsRouter);

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
