import { getRedisClient } from '@roadwatch/redis';
import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { registerFabricIdentity, verifyFabricIdentity } from '../auth/fabric.js';
import { signAccessToken, signRefreshToken } from '../auth/jwt.js';
import { requestOtp, verifyOtp } from '../auth/otp.js';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../auth/password.js';
import {
    clearRefreshCookie,
    getRefreshTokenFromReq,
    revokeRefreshTokenByHash,
    setRefreshCookie,
    storeRefreshToken,
    verifyAndConsumeRefreshToken
} from '../auth/refresh.js';
import { getUserByIdentifier, getUserByPhone, upsertUser } from '../db.js';
import { pool } from '../postgres.js';
import { requireAuth } from '../rbac.js';
import { decryptPhone, hashPhone } from '../security/phone.js';

function normalizeLoginIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) return trimmed;
  if (/^\+?\d[\d\s\-()]+$/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase();
}

async function resolveUserForLogin(
  identifier: string,
  allowedRoles: Array<'CE' | 'EE' | 'CONTRACTOR' | 'CITIZEN'>
): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getUserByIdentifier>>>; phone: string } | null> {
  const user = await getUserByIdentifier(normalizeLoginIdentifier(identifier));
  if (!user || !allowedRoles.includes(user.role)) return null;
  const phone = user.phoneEnc ? decryptPhone(user.phoneEnc) : user.phone;
  if (!phone) return null;
  return { user, phone };
}

const router = express.Router();

router.post('/authority/otp/request', async (req, res) => {
  const body = z.object({ identifier: z.string().min(1).optional(), phone: z.string().min(6).optional() }).parse(req.body);
  const identifier = body.identifier ?? body.phone;
  if (!identifier) return res.status(400).json({ error: 'Missing phone or identifier' });

  const resolved = await resolveUserForLogin(identifier, ['CE', 'EE']);
  if (!resolved) return res.status(403).json({ error: 'Authority account not registered or use the authority login path' });

  const result = await requestOtp(resolved.phone, 'AUTHORITY');
  res.json(result);
});

router.get('/authority/otp/status', async (req, res) => {
  const query = z.object({ identifier: z.string().min(1).optional(), phone: z.string().min(6).optional() }).parse(req.query);
  const identifier = query.identifier ?? query.phone;
  if (!identifier) return res.status(400).json({ error: 'Missing phone or identifier' });

  const resolved = await resolveUserForLogin(identifier, ['CE', 'EE']);
  if (!resolved) return res.status(403).json({ error: 'Authority account not registered' });

  const { getOtpStatus } = await import('../auth/otp.js');
  const status = await getOtpStatus(resolved.phone, 'AUTHORITY');
  res.json(status);
});

router.post('/authority/otp/verify', async (req, res) => {
  const body = z
    .object({
      identifier: z.string().min(1).optional(),
      phone: z.string().min(6).optional(),
      sessionId: z.string().uuid(),
      code: z.string().min(4)
    })
    .parse(req.body);

  const identifier = body.identifier ?? body.phone;
  if (!identifier) return res.status(400).json({ error: 'Missing phone or identifier' });

  const resolved = await resolveUserForLogin(identifier, ['CE', 'EE']);
  if (!resolved) return res.status(403).json({ error: 'Authority account not registered or use the authority login path' });

  const ok = await verifyOtp({ phone: resolved.phone, code: body.code, purpose: 'AUTHORITY', sessionId: body.sessionId });
  if (!ok) return res.status(401).json({ error: 'Invalid or expired OTP' });

  const user = resolved.user;

  const token = signAccessToken({
    sub: user.id,
    phone: user.phone,
    phoneHash: user.phoneHash ?? hashPhone(user.phone),
    role: user.role,
    districts: user.districts,
    zones: user.zones
  });

  res.json({
    token,
    user: {
      id: user.id,
      phone: user.phone,
      username: user.username,
      phoneHash: user.phoneHash ?? hashPhone(user.phone),
      clerkUserId: user.clerkUserId,
      email: user.email,
      role: user.role,
      districts: user.districts,
      zones: user.zones
    }
  });
});

router.post('/contractor/otp/request', async (req, res) => {
  const body = z.object({ identifier: z.string().min(1).optional(), phone: z.string().min(6).optional() }).parse(req.body);
  const identifier = body.identifier ?? body.phone;
  if (!identifier) return res.status(400).json({ error: 'Missing phone or identifier' });

  const resolved = await resolveUserForLogin(identifier, ['CONTRACTOR']);
  if (!resolved) return res.status(403).json({ error: 'Contractor account not registered or use the contractor login path' });

  const result = await requestOtp(resolved.phone, 'CONTRACTOR');
  res.json(result);
});

router.get('/contractor/otp/status', async (req, res) => {
  const query = z.object({ identifier: z.string().min(1).optional(), phone: z.string().min(6).optional() }).parse(req.query);
  const identifier = query.identifier ?? query.phone;
  if (!identifier) return res.status(400).json({ error: 'Missing phone or identifier' });

  const resolved = await resolveUserForLogin(identifier, ['CONTRACTOR']);
  if (!resolved) return res.status(403).json({ error: 'Contractor account not registered' });

  const { getOtpStatus } = await import('../auth/otp.js');
  const status = await getOtpStatus(resolved.phone, 'CONTRACTOR');
  res.json(status);
});

router.post('/contractor/otp/verify', async (req, res) => {
  const body = z
    .object({
      identifier: z.string().min(1).optional(),
      phone: z.string().min(6).optional(),
      sessionId: z.string().uuid(),
      code: z.string().min(4)
    })
    .parse(req.body);

  const identifier = body.identifier ?? body.phone;
  if (!identifier) return res.status(400).json({ error: 'Missing phone or identifier' });

  const resolved = await resolveUserForLogin(identifier, ['CONTRACTOR']);
  if (!resolved) return res.status(403).json({ error: 'Contractor account not registered or use the contractor login path' });

  const ok = await verifyOtp({ phone: resolved.phone, code: body.code, purpose: 'CONTRACTOR', sessionId: body.sessionId });
  if (!ok) return res.status(401).json({ error: 'Invalid or expired OTP' });

  const user = resolved.user;

  const token = signAccessToken({
    sub: user.id,
    phone: user.phone,
    phoneHash: user.phoneHash ?? hashPhone(user.phone),
    role: user.role,
    districts: user.districts,
    zones: user.zones
  });

  res.json({
    token,
    user: {
      id: user.id,
      phone: user.phone,
      username: user.username,
      phoneHash: user.phoneHash ?? hashPhone(user.phone),
      clerkUserId: user.clerkUserId,
      email: user.email,
      role: user.role,
      districts: user.districts,
      zones: user.zones
    }
  });
});

router.post('/citizen/otp/request', async (req, res) => {
  const body = z.object({ phone: z.string().min(6) }).parse(req.body);
  const result = await requestOtp(body.phone, 'CITIZEN');
  res.json(result);
});

router.get('/citizen/otp/status', async (req, res) => {
  const query = z.object({ phone: z.string().min(6) }).parse(req.query);
  const { getOtpStatus } = await import('../auth/otp.js');
  const status = await getOtpStatus(query.phone, 'CITIZEN');
  res.json(status);
});

router.post('/citizen/otp/verify', async (req, res) => {
  const body = z
    .object({
      phone: z.string().min(6),
      sessionId: z.string().uuid(),
      code: z.string().min(4)
    })
    .parse(req.body);

  const ok = await verifyOtp({ ...body, purpose: 'CITIZEN' });
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
    phoneHash: user.phoneHash ?? hashPhone(user.phone),
    role: user.role,
    districts: user.districts,
    zones: user.zones
  });

  res.json({
    token,
    user: {
      id: user.id,
      phone: user.phone,
      username: user.username,
      phoneHash: user.phoneHash ?? hashPhone(user.phone),
      clerkUserId: user.clerkUserId,
      email: user.email,
      role: user.role,
      districts: user.districts,
      zones: user.zones
    }
  });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: (req as any).user });
});

/**
 * POST /auth/refresh
 * Rotate refresh token and issue a new access token
 */
router.post('/refresh', async (req, res) => {
  try {
    const data = await verifyAndConsumeRefreshToken(req);
    if (!data) return res.status(401).json({ error: 'Invalid refresh token' });

    await revokeRefreshTokenByHash(data.token);

    const newRefresh = signRefreshToken({ sub: data.payload.sub });
    await storeRefreshToken(newRefresh, data.payload.sub);
    setRefreshCookie(res, newRefresh);

    const userRes = await pool.query<{
      id: string; role: string; districts: string[]; zones: string[]; phone: string | null; phone_hash: string | null;
    }>(
      `SELECT id, role, districts, zones, phone, phone_hash
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [data.payload.sub]
    );
    const user = userRes.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    const accessToken = signAccessToken({
      sub: user.id,
      phone: user.phone ?? null,
      phoneHash: user.phone_hash ?? null,
      role: user.role,
      districts: user.districts ?? [],
      zones: user.zones ?? []
    });

    res.json({ token: accessToken });
  } catch (error) {
    console.error('Refresh error', error);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

/**
 * POST /auth/logout
 * Revoke current refresh token and clear cookie
 */
router.post('/logout', async (req, res) => {
  try {
    const token = getRefreshTokenFromReq(req);
    if (token) await revokeRefreshTokenByHash(token);
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (error) {
    console.error('Logout error', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ============================================================================
// SIGNUP ENDPOINTS - Custom Auth (Gmail, Phone, or Username)
// ============================================================================

/**
 * POST /auth/citizen/signup
 * Citizens can sign up with email, phone, or username + password
 */
router.post('/citizen/signup', async (req, res) => {
  const body = z
    .object({
      email: z.string().email().optional(),
      phone: z.string().min(6).optional(),
      username: z.string().min(3).max(50).optional(),
      password: z.string().min(8),
      name: z.string().optional()
    })
    .parse(req.body);

  const identifier = body.email || body.phone || body.username;
  if (!identifier) return res.status(400).json({ error: 'Email, phone, or username required' });

  const passwordValidation = validatePasswordStrength(body.password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: 'Password too weak', errors: passwordValidation.errors });
  }

  try {
    if (body.email) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [body.email.toLowerCase()]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    }
    if (body.phone) {
      const existing = await pool.query('SELECT id FROM users WHERE phone_hash = $1 LIMIT 1', [hashPhone(body.phone)]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Phone already registered' });
    }
    if (body.username) {
      const existing = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [body.username]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await hashPassword(body.password);
    const signupMethod = body.email ? 'email' : body.phone ? 'phone' : 'username';
    const userId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, phone, phone_hash, username, password_hash, signup_method, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        body.email?.toLowerCase() ?? null,
        body.phone ?? null,
        body.phone ? hashPhone(body.phone) : null,
        body.username ?? null,
        passwordHash,
        signupMethod,
        'CITIZEN'
      ]
    );

    const token = signAccessToken({
      sub: userId,
      phone: body.phone ?? null,
      phoneHash: body.phone ? hashPhone(body.phone) : null,
      role: 'CITIZEN',
      districts: [],
      zones: []
    });

    res.status(201).json({
      token,
      user: { id: userId, email: body.email ?? null, phone: body.phone ?? null, username: body.username ?? null, role: 'CITIZEN', fabricVerified: false }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

/**
 * POST /auth/citizen/login
 * Citizens log in with email, phone, or username + password
 */
router.post('/citizen/login', async (req, res) => {
  const body = z
    .object({ identifier: z.string().min(1), password: z.string() })
    .parse(req.body);

  try {
    let result;
    if (body.identifier.includes('@')) {
      result = await pool.query(
        `SELECT id, email, phone, phone_hash, username, password_hash, role
         FROM users WHERE role = $1 AND email = $2 LIMIT 1`,
        ['CITIZEN', body.identifier.toLowerCase()]
      );
    } else if (/^\d{6,}$/.test(body.identifier)) {
      result = await pool.query(
        `SELECT id, email, phone, phone_hash, username, password_hash, role
         FROM users WHERE role = $1 AND phone_hash = $2 LIMIT 1`,
        ['CITIZEN', hashPhone(body.identifier)]
      );
    } else {
      result = await pool.query(
        `SELECT id, email, phone, phone_hash, username, password_hash, role
         FROM users WHERE role = $1 AND username = $2 LIMIT 1`,
        ['CITIZEN', body.identifier]
      );
    }

    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (!user.password_hash) return res.status(401).json({ error: 'This account was not created with a password' });

    const passwordValid = await verifyPassword(body.password, user.password_hash);
    if (!passwordValid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signAccessToken({
      sub: user.id,
      phone: user.phone,
      phoneHash: user.phone_hash,
      role: user.role,
      districts: [],
      zones: []
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, phone: user.phone, username: user.username, role: user.role, fabricVerified: false }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/authority/signup
 * Authority signup with username + password + Fabric identity
 */
router.post('/authority/signup', async (req, res) => {
  const body = z
    .object({
      email: z.string().email(),
      username: z.string().min(3).max(50),
      password: z.string().min(8),
      phone: z.string().min(6).optional(),
      fabricCertPem: z.string(),
      fabricMspId: z.string(),
      fabricOrgName: z.string(),
      districts: z.array(z.string()).optional(),
      zones: z.array(z.string()).optional()
    })
    .parse(req.body);

  const passwordValidation = validatePasswordStrength(body.password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: 'Password too weak', errors: passwordValidation.errors });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1',
      [body.email.toLowerCase(), body.username]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email or username already exists' });

    const passwordHash = await hashPassword(body.password);
    const userId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, username, password_hash, phone, signup_method, role, districts, zones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        body.email.toLowerCase(),
        body.username,
        passwordHash,
        body.phone ?? null,
        'email',
        'CE',
        body.districts ?? [],
        body.zones ?? []
      ]
    );

    await registerFabricIdentity({ userId, role: 'CE', orgName: body.fabricOrgName, certPem: body.fabricCertPem, mspId: body.fabricMspId });
    const fabricVerified = await verifyFabricIdentity({ userId, role: 'CE', certPem: body.fabricCertPem });

    const token = signAccessToken({
      sub: userId,
      phone: body.phone ?? null,
      phoneHash: body.phone ? hashPhone(body.phone) : null,
      role: 'CE',
      districts: body.districts ?? [],
      zones: body.zones ?? []
    });

    res.status(201).json({
      token,
      user: { id: userId, email: body.email, username: body.username, role: 'CE', fabricVerified, districts: body.districts ?? [], zones: body.zones ?? [] }
    });
  } catch (error) {
    console.error('Authority signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

/**
 * POST /auth/authority/login
 * Authority login with username/email + password
 */
router.post('/authority/login', async (req, res) => {
  const body = z
    .object({ identifier: z.string().min(1), password: z.string() })
    .parse(req.body);

  try {
    const result = await pool.query(
      `SELECT id, email, username, password_hash, role, phone, phone_hash, districts, zones, fabric_verified
       FROM users
       WHERE role = ANY($1::text[])
         AND (${body.identifier.includes('@') ? 'email = $2' : 'username = $2'})
       LIMIT 1`,
      [['CE', 'EE'], body.identifier.includes('@') ? body.identifier.toLowerCase() : body.identifier]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (!user.password_hash) return res.status(401).json({ error: 'This account was not created with a password' });

    const passwordValid = await verifyPassword(body.password, user.password_hash);
    if (!passwordValid) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.fabric_verified) return res.status(403).json({ error: 'Fabric identity not verified. Contact administrator.' });

    const token = signAccessToken({
      sub: user.id,
      phone: user.phone,
      phoneHash: user.phone_hash,
      role: user.role,
      districts: user.districts ?? [],
      zones: user.zones ?? []
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, username: user.username, role: user.role, fabricVerified: user.fabric_verified, districts: user.districts ?? [], zones: user.zones ?? [] }
    });
  } catch (error) {
    console.error('Authority login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/contractor/signup
 * Contractor signup with username + password + Fabric identity
 */
router.post('/contractor/signup', async (req, res) => {
  const body = z
    .object({
      email: z.string().email(),
      username: z.string().min(3).max(50),
      password: z.string().min(8),
      phone: z.string().min(6).optional(),
      companyName: z.string(),
      fabricCertPem: z.string(),
      fabricMspId: z.string(),
      fabricOrgName: z.string(),
      districts: z.array(z.string()).optional(),
      zones: z.array(z.string()).optional()
    })
    .parse(req.body);

  const passwordValidation = validatePasswordStrength(body.password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: 'Password too weak', errors: passwordValidation.errors });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1',
      [body.email.toLowerCase(), body.username]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email or username already exists' });

    const passwordHash = await hashPassword(body.password);
    const userId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, username, password_hash, phone, signup_method, role, districts, zones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        body.email.toLowerCase(),
        body.username,
        passwordHash,
        body.phone ?? null,
        'email',
        'CONTRACTOR',
        body.districts ?? [],
        body.zones ?? []
      ]
    );

    await registerFabricIdentity({ userId, role: 'CONTRACTOR', orgName: body.fabricOrgName, certPem: body.fabricCertPem, mspId: body.fabricMspId });
    const fabricVerified = await verifyFabricIdentity({ userId, role: 'CONTRACTOR', certPem: body.fabricCertPem });

    const token = signAccessToken({
      sub: userId,
      phone: body.phone ?? null,
      phoneHash: body.phone ? hashPhone(body.phone) : null,
      role: 'CONTRACTOR',
      districts: body.districts ?? [],
      zones: body.zones ?? []
    });

    res.status(201).json({
      token,
      user: { id: userId, email: body.email, username: body.username, company: body.companyName, role: 'CONTRACTOR', fabricVerified, districts: body.districts ?? [], zones: body.zones ?? [] }
    });
  } catch (error) {
    console.error('Contractor signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

/**
 * POST /auth/contractor/login
 * Contractor login with username/email + password
 */
router.post('/contractor/login', async (req, res) => {
  const body = z
    .object({ identifier: z.string().min(1), password: z.string() })
    .parse(req.body);

  try {
    const result = await pool.query(
      `SELECT id, email, username, password_hash, role, phone, phone_hash, districts, zones, fabric_verified
       FROM users
       WHERE role = $1
         AND (${body.identifier.includes('@') ? 'email = $2' : 'username = $2'})
       LIMIT 1`,
      ['CONTRACTOR', body.identifier.includes('@') ? body.identifier.toLowerCase() : body.identifier]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (!user.password_hash) return res.status(401).json({ error: 'This account was not created with a password' });

    const passwordValid = await verifyPassword(body.password, user.password_hash);
    if (!passwordValid) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.fabric_verified) return res.status(403).json({ error: 'Fabric identity not verified. Contact administrator.' });

    const token = signAccessToken({
      sub: user.id,
      phone: user.phone,
      phoneHash: user.phone_hash,
      role: user.role,
      districts: user.districts ?? [],
      zones: user.zones ?? []
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, username: user.username, role: user.role, fabricVerified: user.fabric_verified, districts: user.districts ?? [], zones: user.zones ?? [] }
    });
  } catch (error) {
    console.error('Contractor login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Right-to-deletion / account deletion.
// Deletes the user record (cascades notification prefs/inbox/deliveries) and pseudonymizes audit logs.
router.delete('/me', requireAuth, async (req, res) => {
  const user = (req as any).user as { sub: string; phoneHash?: string };

  // Pseudonymize audit logs (retain actions but remove linkability to a person).
  await pool.query(
    `UPDATE audit_log
     SET actor_user_id = NULL, actor_phone_hash = NULL, actor_phone_masked = NULL
     WHERE actor_user_id = $1`,
    [user.sub]
  );

  // Delete OTP sessions keyed by phone hash (best-effort).
  if (user.phoneHash) {
    const redis = getRedisClient();
    await redis.del(`otp:${user.phoneHash}`);
    await redis.del(`otp_rate:${user.phoneHash}`);
  }

  // Delete user; notification tables cascade via FK.
  await pool.query('DELETE FROM users WHERE id = $1', [user.sub]);

  res.json({ ok: true });
});

export default router;