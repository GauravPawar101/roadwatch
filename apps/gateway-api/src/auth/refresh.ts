import crypto from 'crypto';
import type { Request, Response } from 'express';
import { execute } from '../cassandra.js';
import { getEnv } from '../env.js';
import { verifyRefreshToken } from './jwt.js';

const env = getEnv();

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function storeRefreshToken(token: string, userId: string): Promise<void> {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  // Attempt to insert into refresh_tokens; if table missing, bubble error.
  await execute('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, is_revoked) VALUES (?, ?, ?, ?)', [userId, tokenHash, expiresAt, false], { prepare: true });
}

export async function revokeRefreshTokenByHash(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await execute('UPDATE refresh_tokens SET is_revoked = ? WHERE token_hash = ?', [true, tokenHash], { prepare: true });
}

export async function findValidRefreshToken(token: string) {
  const tokenHash = hashToken(token);
  const result = await execute('SELECT id, user_id, expires_at, is_revoked FROM refresh_tokens WHERE token_hash = ? LIMIT 1', [tokenHash], { prepare: true });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (row.is_revoked) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

export function setRefreshCookie(res: Response, token: string) {
  const maxAgeMs = env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
  // Secure and SameSite strict in production
  const cookieOptions: any = {
    httpOnly: true,
    maxAge: maxAgeMs,
    path: '/auth',
    sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax'
  };
  if (env.NODE_ENV === 'production') cookieOptions.secure = true;
  res.cookie('refresh_token', token, cookieOptions);
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie('refresh_token', { path: '/auth' });
}

export function getRefreshTokenFromReq(req: Request): string | null {
  // Try cookies first
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const pairs = cookieHeader.split(';').map((s) => s.trim());
    for (const p of pairs) {
      const [k, v] = p.split('=');
      if (k === 'refresh_token') return decodeURIComponent(v || '');
    }
  }
  // Fallback: Authorization header bearer refresh token (not recommended)
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export async function verifyAndConsumeRefreshToken(req: Request) {
  const token = getRefreshTokenFromReq(req);
  if (!token) return null;
  try {
    const payload = verifyRefreshToken(token);
    const row = await findValidRefreshToken(token);
    if (!row) return null;
    return { token, payload, row };
  } catch (e) {
    return null;
  }
}
