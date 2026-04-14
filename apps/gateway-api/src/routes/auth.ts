import express from 'express';
import { z } from 'zod';
import { signAccessToken } from '../auth/jwt.js';
import { requestOtp, verifyOtp } from '../auth/otp.js';
import { getUserByPhone, pool, upsertUser } from '../db.js';
import { requireAuth } from '../rbac.js';
import { hashPhone } from '../security/phone.js';

const router = express.Router();

router.post('/otp/request', async (req, res) => {
  const body = z.object({ phone: z.string().min(6) }).parse(req.body);
  const result = await requestOtp(body.phone);
  res.json(result);
});

router.post('/otp/verify', async (req, res) => {
  const body = z
    .object({
      phone: z.string().min(6),
      sessionId: z.string().uuid(),
      code: z.string().min(4)
    })
    .parse(req.body);

  const ok = await verifyOtp(body);
  if (!ok) return res.status(401).json({ error: 'Invalid or expired OTP' });

  // Authority/admin login: account must already exist (created by an admin).
  // This prevents anyone from self-registering as an authority role via OTP.
  const user = await getUserByPhone(body.phone);
  if (!user) return res.status(403).json({ error: 'User not registered' });
  if (user.role === 'CITIZEN') return res.status(403).json({ error: 'Use citizen login' });

  const token = signAccessToken({
    sub: user.id,
    phone: user.phone,
    phoneHash: user.phoneHash ?? hashPhone(body.phone),
    role: user.role,
    districts: user.districts,
    zones: user.zones
  });

  res.json({
    token,
    user: {
      id: user.id,
      phone: user.phone,
      phoneHash: user.phoneHash ?? hashPhone(body.phone),
      role: user.role,
      districts: user.districts,
      zones: user.zones
    }
  });
});

router.post('/citizen/otp/request', async (req, res) => {
  const body = z.object({ phone: z.string().min(6) }).parse(req.body);
  const result = await requestOtp(body.phone);
  res.json(result);
});

router.post('/citizen/otp/verify', async (req, res) => {
  const body = z
    .object({
      phone: z.string().min(6),
      sessionId: z.string().uuid(),
      code: z.string().min(4)
    })
    .parse(req.body);

  const ok = await verifyOtp(body);
  if (!ok) return res.status(401).json({ error: 'Invalid or expired OTP' });

  const existing = await getUserByPhone(body.phone);
  if (existing && existing.role !== 'CITIZEN') return res.status(403).json({ error: 'Use authority login' });

  const user =
    existing ??
    (await upsertUser({
      phone: body.phone,
      role: 'CITIZEN',
      districts: [],
      zones: []
    }));

  const token = signAccessToken({
    sub: user.id,
    phone: user.phone,
    phoneHash: user.phoneHash ?? hashPhone(body.phone),
    role: user.role,
    districts: user.districts,
    zones: user.zones
  });

  res.json({
    token,
    user: {
      id: user.id,
      phone: user.phone,
      phoneHash: user.phoneHash ?? hashPhone(body.phone),
      role: user.role,
      districts: user.districts,
      zones: user.zones
    }
  });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: (req as any).user });
});

// Right-to-deletion / account deletion.
// Deletes the user record (cascades notification prefs/inbox/deliveries) and pseudonymizes audit logs.
router.delete('/me', requireAuth, async (req, res) => {
  const user = (req as any).user as { sub: string; phoneHash?: string };

  // Pseudonymize audit logs (retain actions but remove linkability to a person).
  await pool.query(
    `UPDATE audit_log
     SET actor_user_id = NULL,
         actor_phone_hash = NULL,
         actor_phone_masked = NULL
     WHERE actor_user_id = $1;`,
    [user.sub]
  );

  // Delete OTP sessions keyed by phone hash (best-effort).
  if (user.phoneHash) {
    await pool.query(`DELETE FROM otp_sessions WHERE phone_hash = $1;`, [user.phoneHash]);
  }

  // Delete user; notification tables cascade via FK.
  await pool.query(`DELETE FROM users WHERE id = $1;`, [user.sub]);

  res.json({ ok: true });
});

export default router;
