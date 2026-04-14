import express from 'express';
import { z } from 'zod';
import { createAgent } from '../agent/createAgent.js';
import { verifyAccessToken } from '../auth/jwt.js';

const router = express.Router();

const chatSchema = z.object({
  input: z.string().min(1).max(4000),
  system: z.string().min(1).max(4000).optional()
});

// Create once per process.
const { agent } = createAgent();

router.post('/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_request',
      details: parsed.error.flatten()
    });
  }

  // Optional auth context: if a valid access token is provided, enable authority tooling.
  // If the token is present but invalid, fail fast.
  let actor: any | undefined;
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = bearer ?? queryToken;
  if (token) {
    try {
      actor = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  try {
    const result = await agent.invoke({ ...parsed.data, actor });

    // Prefer not to leak internals; expose only minimal provider/model for debugging.
    return res.json({
      reply: result.reply,
      provider: result.provider,
      model: result.model
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return res.status(502).json({ error: 'llm_unavailable', message: msg });
  }
});

export default router;
