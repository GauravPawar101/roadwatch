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
import { execute } from '../cassandra.js';
import { getUserByIdentifier, getUserByPhone, upsertUser } from '../db.js';
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

    // Revoke old token
    await revokeRefreshTokenByHash(data.token);

    // Issue new refresh token and store it
    const newRefresh = signRefreshToken({ sub: data.payload.sub });
    await storeRefreshToken(newRefresh, data.payload.sub);
    setRefreshCookie(res, newRefresh);

    // Issue new access token
    // Load user to include districts/zones
    const userRes = await execute('SELECT id, role, districts, zones, phone, phone_hash FROM users WHERE id = ? LIMIT 1', [data.payload.sub], { prepare: true });
    const user = userRes.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    const accessToken = signAccessToken({
      sub: user.id,
      phone: user.phone || null,
      phoneHash: user.phone_hash || null,
      role: user.role,
      districts: user.districts || [],
      zones: user.zones || []
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
    if (token) {
      await revokeRefreshTokenByHash(token);
    }
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

  // At least one identifier required
  const identifier = body.email || body.phone || body.username;
  if (!identifier) {
    return res.status(400).json({ error: 'Email, phone, or username required' });
  }

  // Validate password strength
  const passwordValidation = validatePasswordStrength(body.password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: 'Password too weak', errors: passwordValidation.errors });
  }

  try {
    // Check if user already exists
    if (body.email) {
      const existing = await execute('SELECT id FROM users WHERE email = ? LIMIT 1', [body.email.toLowerCase()], { prepare: true });
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }
    }
    if (body.phone) {
      const existing = await execute('SELECT id FROM users WHERE phone_hash = ? LIMIT 1', [hashPhone(body.phone)], { prepare: true });
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Phone already registered' });
      }
    }
    if (body.username) {
      const existing = await execute('SELECT id FROM users WHERE username = ? LIMIT 1', [body.username], { prepare: true });
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Username already taken' });
      }
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Determine signup method
    const signupMethod = body.email ? 'email' : body.phone ? 'phone' : 'username';

    // Create user — generate id client-side for Cassandra and insert
    const userId = crypto.randomUUID();
    await execute(
      `INSERT INTO users (id, email, phone, phone_hash, username, password_hash, signup_method, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        body.email?.toLowerCase() || null,
        body.phone || null,
        body.phone ? hashPhone(body.phone) : null,
        body.username || null,
        passwordHash,
        signupMethod,
        'CITIZEN'
      ],
      { prepare: true }
    );

    // Create JWT token
    const token = signAccessToken({
      sub: userId,
      phone: body.phone || null,
      phoneHash: body.phone ? hashPhone(body.phone) : null,
      role: 'CITIZEN',
      districts: [],
      zones: []
    });

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: body.email || null,
        phone: body.phone || null,
        username: body.username || null,
        role: 'CITIZEN',
        fabricVerified: false
      }
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
    .object({
      identifier: z.string().min(1), // email, phone, or username
      password: z.string()
    })
    .parse(req.body);

  try {
    // Find user by email, phone, or username
    let result;
    if (body.identifier.includes('@')) {
      // Email
      result = await execute('SELECT id, email, phone, phone_hash, username, password_hash, role FROM users WHERE role = ? AND email = ? LIMIT 1 ALLOW FILTERING', ['CITIZEN', body.identifier.toLowerCase()], { prepare: true });
    } else if (/^\d{6,}$/.test(body.identifier)) {
      // Phone
      result = await execute('SELECT id, email, phone, phone_hash, username, password_hash, role FROM users WHERE role = ? AND phone_hash = ? LIMIT 1 ALLOW FILTERING', ['CITIZEN', hashPhone(body.identifier)], { prepare: true });
    } else {
      // Username
      result = await execute('SELECT id, email, phone, phone_hash, username, password_hash, role FROM users WHERE role = ? AND username = ? LIMIT 1 ALLOW FILTERING', ['CITIZEN', body.identifier], { prepare: true });
    }

    if (!result || (result.rows || []).length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account was not created with a password' });
    }

    const passwordValid = await verifyPassword(body.password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT token
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
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        username: user.username,
        role: user.role,
        fabricVerified: false
      }
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

  // Validate password
  const passwordValidation = validatePasswordStrength(body.password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: 'Password too weak', errors: passwordValidation.errors });
  }

  try {
    // Check existing user
    const existing = await execute('SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1', [body.email.toLowerCase(), body.username], { prepare: true });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create user (generate id client-side for Cassandra)
    const userId = crypto.randomUUID();
    await execute(`INSERT INTO users (id, email, username, password_hash, phone, signup_method, role, districts, zones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      userId,
      body.email.toLowerCase(),
      body.username,
      passwordHash,
      body.phone || null,
      'email',
      'CE',
      body.districts || [],
      body.zones || []
    ], { prepare: true });

    // Register Fabric identity
    await registerFabricIdentity({
      userId,
      role: 'CE',
      orgName: body.fabricOrgName,
      certPem: body.fabricCertPem,
      mspId: body.fabricMspId
    });

    // Verify Fabric identity
    const fabricVerified = await verifyFabricIdentity({
      userId,
      role: 'CE',
      certPem: body.fabricCertPem
    });

    // Create JWT token
    const token = signAccessToken({
      sub: userId,
      phone: body.phone || null,
      phoneHash: body.phone ? hashPhone(body.phone) : null,
      role: 'CE',
      districts: body.districts || [],
      zones: body.zones || []
    });

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: body.email,
        username: body.username,
        role: 'CE',
        fabricVerified,
        districts: body.districts || [],
        zones: body.zones || []
      }
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
    .object({
      identifier: z.string().min(1), // email or username
      password: z.string()
    })
    .parse(req.body);

  try {
    // Find authority user
    let query = `SELECT id, email, username, password_hash, role, phone, phone_hash, 
                        districts, zones, fabric_verified
                 FROM users
                 WHERE role IN ('CE', 'EE') AND (`;

    const params: any[] = [];

    if (body.identifier.includes('@')) {
      query += `email = $${params.length + 1}`;
      params.push(body.identifier.toLowerCase());
    } else {
      query += `username = $${params.length + 1}`;
      params.push(body.identifier);
    }

    query += `) LIMIT 1;`;

    let result;
    if (body.identifier.includes('@')) {
      result = await execute('SELECT id, email, username, password_hash, role, phone, phone_hash, districts, zones, fabric_verified FROM users WHERE role IN (?, ?) AND email = ? LIMIT 1 ALLOW FILTERING', ['CE', 'EE', body.identifier.toLowerCase()], { prepare: true });
    } else {
      result = await execute('SELECT id, email, username, password_hash, role, phone, phone_hash, districts, zones, fabric_verified FROM users WHERE role IN (?, ?) AND username = ? LIMIT 1 ALLOW FILTERING', ['CE', 'EE', body.identifier], { prepare: true });
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account was not created with a password' });
    }

    const passwordValid = await verifyPassword(body.password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check Fabric verification
    if (!user.fabric_verified) {
      return res.status(403).json({ error: 'Fabric identity not verified. Contact administrator.' });
    }

    // Create JWT token
    const token = signAccessToken({
      sub: user.id,
      phone: user.phone,
      phoneHash: user.phone_hash,
      role: user.role,
      districts: user.districts || [],
      zones: user.zones || []
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        fabricVerified: user.fabric_verified,
        districts: user.districts || [],
        zones: user.zones || []
      }
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

  // Validate password
  const passwordValidation = validatePasswordStrength(body.password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: 'Password too weak', errors: passwordValidation.errors });
  }

  try {
    // Check existing user
    const existing = await execute('SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1', [body.email.toLowerCase(), body.username], { prepare: true });

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create user (generate id client-side)
    const userId = crypto.randomUUID();
    await execute(`INSERT INTO users (id, email, username, password_hash, phone, signup_method, role, districts, zones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      userId,
      body.email.toLowerCase(),
      body.username,
      passwordHash,
      body.phone || null,
      'email',
      'CONTRACTOR',
      body.districts || [],
      body.zones || []
    ], { prepare: true });

    // Register Fabric identity
    await registerFabricIdentity({
      userId,
      role: 'CONTRACTOR',
      orgName: body.fabricOrgName,
      certPem: body.fabricCertPem,
      mspId: body.fabricMspId
    });

    // Verify Fabric identity
    const fabricVerified = await verifyFabricIdentity({
      userId,
      role: 'CONTRACTOR',
      certPem: body.fabricCertPem
    });

    // Create JWT token
    const token = signAccessToken({
      sub: userId,
      phone: body.phone || null,
      phoneHash: body.phone ? hashPhone(body.phone) : null,
      role: 'CONTRACTOR',
      districts: body.districts || [],
      zones: body.zones || []
    });

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: body.email,
        username: body.username,
        company: body.companyName,
        role: 'CONTRACTOR',
        fabricVerified,
        districts: body.districts || [],
        zones: body.zones || []
      }
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
    .object({
      identifier: z.string().min(1), // email or username
      password: z.string()
    })
    .parse(req.body);

  try {
    // Find contractor user
    let query = `SELECT id, email, username, password_hash, role, phone, phone_hash, 
                        districts, zones, fabric_verified
                 FROM users
                 WHERE role = 'CONTRACTOR' AND (`;

    const params: any[] = [];

    if (body.identifier.includes('@')) {
      query += `email = $${params.length + 1}`;
      params.push(body.identifier.toLowerCase());
    } else {
      query += `username = $${params.length + 1}`;
      params.push(body.identifier);
    }

    query += `) LIMIT 1;`;

    let result;
    if (body.identifier.includes('@')) {
      result = await execute('SELECT id, email, username, password_hash, role, phone, phone_hash, districts, zones, fabric_verified FROM users WHERE role = ? AND email = ? LIMIT 1 ALLOW FILTERING', ['CONTRACTOR', body.identifier.toLowerCase()], { prepare: true });
    } else {
      result = await execute('SELECT id, email, username, password_hash, role, phone, phone_hash, districts, zones, fabric_verified FROM users WHERE role = ? AND username = ? LIMIT 1 ALLOW FILTERING', ['CONTRACTOR', body.identifier], { prepare: true });
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account was not created with a password' });
    }

    const passwordValid = await verifyPassword(body.password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check Fabric verification
    if (!user.fabric_verified) {
      return res.status(403).json({ error: 'Fabric identity not verified. Contact administrator.' });
    }

    // Create JWT token
    const token = signAccessToken({
      sub: user.id,
      phone: user.phone,
      phoneHash: user.phone_hash,
      role: user.role,
      districts: user.districts || [],
      zones: user.zones || []
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        fabricVerified: user.fabric_verified,
        districts: user.districts || [],
        zones: user.zones || []
      }
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
  await execute(`UPDATE audit_log SET actor_user_id = NULL, actor_phone_hash = NULL, actor_phone_masked = NULL WHERE actor_user_id = ?`, [user.sub], { prepare: true });

  // Delete OTP sessions keyed by phone hash (best-effort).
  if (user.phoneHash) {
    const redis = getRedisClient();
    await redis.del(`otp:${user.phoneHash}`);
    await redis.del(`otp_rate:${user.phoneHash}`);
  }

  // Delete user; notification tables cascade via FK.
  await execute('DELETE FROM users WHERE id = ?', [user.sub], { prepare: true });

  res.json({ ok: true });
});

export default router;
