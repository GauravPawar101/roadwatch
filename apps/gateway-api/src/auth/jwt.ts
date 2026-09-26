import jwt from 'jsonwebtoken';
import type { Role } from '../db.js';
import { getEnv } from '../env.js';

export type JwtClaims = {
  sub: string;
  // phone is masked (e.g. +91******1234) - optional depending on signup
  phone?: string | null;
  // phoneHash is HMAC(phone) for server-side correlation without plaintext
  phoneHash?: string | null;
  role: Role;
  districts?: string[];
  zones?: string[];
};

const env = getEnv();

// Standard claim values, overridable so a deployment can pin its own.
// @roadwatch/backend-api enforces these only when JWT_AUDIENCE / JWT_ISSUER are
// set, so the defaults here keep both sides consistent out of the box.
const DEFAULT_AUDIENCE = 'roadwatch-api';
const DEFAULT_ISSUER = 'roadwatch-auth';

export function signAccessToken(claims: any): string {
  const expires = `${env.ACCESS_TOKEN_EXPIRES_MINUTES}m`;
  return (jwt as any).sign(claims, env.ACCESS_SECRET, {
    expiresIn: expires,
    audience: process.env.JWT_AUDIENCE || DEFAULT_AUDIENCE,
    issuer: process.env.JWT_ISSUER || DEFAULT_ISSUER,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verifyAccessToken(token: string): JwtClaims {
  const payload = (jwt as any).verify(token, env.ACCESS_SECRET) as JwtClaims;

  // `sub` is persisted into uuid columns (complaints.user_id, audit rows, ...).
  // A non-UUID subject used to reach Postgres and abort the surrounding
  // transaction, which surfaced as an unhandled rejection and killed the
  // process. Reject it at the edge instead.
  if (typeof payload?.sub !== 'string' || !UUID_RE.test(payload.sub)) {
    throw new jwt.JsonWebTokenError('invalid_token: sub must be a UUID');
  }

  return payload;
}

export function signRefreshToken(payload: { sub: string }): string {
  const expires = `${env.REFRESH_TOKEN_EXPIRES_DAYS}d`;
  const secret = (env.REFRESH_SECRET || env.JWT_SECRET) as string;
  return (jwt as any).sign(payload, secret, { expiresIn: expires });
}

export function verifyRefreshToken(token: string): { sub: string } {
  const secret = (env.REFRESH_SECRET || env.JWT_SECRET) as string;
  const payload = (jwt as any).verify(token, secret);
  return payload as { sub: string };
}
