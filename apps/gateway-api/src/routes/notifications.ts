import express from 'express';
import { z } from 'zod';
import type { JwtClaims } from '../auth/jwt.js';
import type { NotificationChannel, NotificationPreferences } from '../notifications/domain.js';
import {
    getOrCreatePreferences,
    listInbox,
    markInboxRead,
    topicsForUser,
    updatePreferences
} from '../notifications/service.js';
import { requireAuth } from '../rbac.js';

const router = express.Router();

router.get('/inbox', requireAuth, async (req, res) => {
  const user = (req as any).user as JwtClaims;
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(200).optional().default(50)
    })
    .parse(req.query);

  const items = await listInbox(user.sub, query.limit);
  res.json({ items });
});

router.post('/inbox/:inboxId/read', requireAuth, async (req, res) => {
  const user = (req as any).user as JwtClaims;
  const params = z.object({ inboxId: z.string().min(1) }).parse(req.params);
  await markInboxRead(user.sub, params.inboxId);
  res.json({ ok: true });
});

router.get('/preferences', requireAuth, async (req, res) => {
  const user = (req as any).user as JwtClaims;
  const prefs = await getOrCreatePreferences(user.sub);
  res.json({ preferences: prefs });
});

router.put('/preferences', requireAuth, async (req, res) => {
  const user = (req as any).user as JwtClaims;

  const channelEnum = z.enum(['IN_APP', 'FCM', 'SMS', 'WHATSAPP']);

  const body = z
    .object({
      enabledChannels: z.array(channelEnum).optional(),
      doNotDisturb: z
        .object({
          enabled: z.boolean(),
          startMinutes: z.number().int().min(0).max(1439),
          endMinutes: z.number().int().min(0).max(1439),
          timeZone: z.string().min(1)
        })
        .optional(),
      authorityBatching: z.enum(['IMMEDIATE', 'DAILY_DIGEST']).optional(),
      digestMinutes: z.number().int().min(0).max(1439).optional()
    })
    .parse(req.body);

  // Ensure IN_APP is never fully disabled (required for in-app history).
  const patch: Partial<NotificationPreferences> = {
    enabledChannels: body.enabledChannels
      ? (Array.from(new Set(['IN_APP', ...body.enabledChannels])) as NotificationChannel[])
      : undefined,
    doNotDisturb: body.doNotDisturb,
    authorityBatching: body.authorityBatching,
    digestMinutes: body.digestMinutes
  };

  const prefs = await updatePreferences(user.sub, patch);
  res.json({ preferences: prefs });
});

router.get('/topics', requireAuth, async (req, res) => {
  const user = (req as any).user as JwtClaims;
  const topics = topicsForUser({ userId: user.sub, districts: user.districts, zones: user.zones });
  res.json({ topics });
});

export default router;
