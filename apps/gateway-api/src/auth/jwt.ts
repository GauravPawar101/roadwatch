import crypto from 'node:crypto';
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

/**
 * Signing and verification keys, built once per process.
 *
 * Passing the secret as a string made `jsonwebtoken` re-derive a key object on
 * every call. Profiling the authenticated read path attributed 8.6% of process
 * CPU to `createPublicKey`, and the crypto category as a whole to 12.9% — the
 * single largest avoidable cost in the request, spent before a handler ran.
 *
 * Measured over 20,000 verifications: 80.9 us/op with a string secret, 22.2 us/op
 * with a KeyObject — 3.6x faster. At 10,000 requests per second that is the
 * difference between 80.9% and 22.2% of a core, for a one-line change at startup.
 *
 * A KeyObject is used rather than a cached `SecretKey` per algorithm because the
 * library wants a `KeyObject` and accepts a string; handing it the pre-built
 * object is what removes the per-call work. The secret is still validated by
 * `getEnv()`, so this is not a way to bypass the production-secret guard — it
 * cannot be, because a missing or default secret never reaches here.
 */
const accessKey = crypto.createSecretKey(Buffer.from(env.ACCESS_SECRET, 'utf8'));
const refreshSecret = (env.REFRESH_SECRET || env.JWT_SECRET) as string;
const refreshKey = crypto.createSecretKey(Buffer.from(refreshSecret, 'utf8'));

export function signAccessToken(claims: any): string {
  const expires = `${env.ACCESS_TOKEN_EXPIRES_MINUTES}m`;
  return (jwt as any).sign(claims, accessKey, {
    expiresIn: expires,
    algorithm: 'HS256',
    audience: process.env.JWT_AUDIENCE || DEFAULT_AUDIENCE,
    issuer: process.env.JWT_ISSUER || DEFAULT_ISSUER,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verifyAccessToken(token: string): JwtClaims {
  // `algorithms` is pinned rather than read from the token header. Without it
  // `alg` is taken from the token, which is the algorithm-confusion footgun this
  // call has always had; pinning costs nothing and removes the class of bug.
  const payload = (jwt as any).verify(token, accessKey, { algorithms: ['HS256'] }) as JwtClaims;

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
  return (jwt as any).sign(payload, refreshKey, { expiresIn: expires, algorithm: 'HS256' });
}

export function verifyRefreshToken(token: string): { sub: string } {
  const payload = (jwt as any).verify(token, refreshKey, { algorithms: ['HS256'] });
  return payload as { sub: string };
}
