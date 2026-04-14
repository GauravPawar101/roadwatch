import jwt from 'jsonwebtoken';
import type { Role } from '../db.js';
import { getEnv } from '../env.js';

export type JwtClaims = {
  sub: string;
  // phone is masked (e.g. +91******1234)
  phone: string;
  // phoneHash is HMAC(phone) for server-side correlation without plaintext
  phoneHash: string;
  role: Role;
  districts: string[];
  zones: string[];
};

export function signAccessToken(claims: JwtClaims): string {
  return jwt.sign(claims, getEnv().JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '12h'
  });
}

export function verifyAccessToken(token: string): JwtClaims {
  const payload = jwt.verify(token, getEnv().JWT_SECRET);
  // jsonwebtoken returns string | object; we only sign objects
  return payload as JwtClaims;
}
