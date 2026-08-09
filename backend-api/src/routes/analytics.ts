import express from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { z } from 'zod';
import { validateServiceJWT } from '../middleware/jwt.js';

const router = express.Router();

const payloadSchema = z.object({
  event: z.string().min(1),
  timestamp: z.number().optional(),
  // allow any additional properties
}).passthrough();

// Simple collector endpoint. Intended as a local/dev stub.
router.post('/collect', validateServiceJWT, (req: Request, res: Response) => {
  try {
    const body = payloadSchema.parse(req.body);
    // Light logging for local inspection. In production, forward to analytics provider.
    console.log('[analytics collector] received', JSON.stringify(body));
    // Persisting or forwarding can be added here.
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid payload' });
  }
});

export default router;
