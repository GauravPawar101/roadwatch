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

export function signAccessToken(claims: any): string {
  const expires = `${env.ACCESS_TOKEN_EXPIRES_MINUTES}m`;
  const secret = (env.ACCESS_SECRET || env.JWT_SECRET) as string;
  return (jwt as any).sign(claims, secret, { expiresIn: expires });
}

export function verifyAccessToken(token: string): JwtClaims {
  const secret = (env.ACCESS_SECRET || env.JWT_SECRET) as string;
  const payload = (jwt as any).verify(token, secret);
  return payload as JwtClaims;
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
