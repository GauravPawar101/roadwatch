import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtClaims } from './auth/jwt.js';
import { verifyAccessToken } from './auth/jwt.js';

export type AuthedRequest = Request & { user: JwtClaims };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length);
    try {
      (req as AuthedRequest).user = verifyAccessToken(token);
      return next();
    } catch (e: any) {
      if (e instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ code: 'TOKEN_EXPIRED', error: 'Token expired' });
      }
      if (e instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ code: 'INVALID_TOKEN', error: 'Invalid token' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // SSE cannot send Authorization header with EventSource; support token query.
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (token) {
    try {
      (req as AuthedRequest).user = verifyAccessToken(token);
      return next();
    } catch (e: any) {
      if (e instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ code: 'TOKEN_EXPIRED', error: 'Token expired' });
      }
      if (e instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ code: 'INVALID_TOKEN', error: 'Invalid token' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  return res.status(401).json({ error: 'Missing token' });
}

export function requireRole(roles: Array<JwtClaims['role']>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user) return res.status(401).json({ error: 'Missing auth context' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

export function assertDistrictAccess(user: JwtClaims, district: string): boolean {
  if (user.role === 'CE') return true;
  const districts = user.districts || [];
  if (districts.includes('ALL')) return true;
  return districts.includes(district);
}

export function assertZoneAccess(user: JwtClaims, zone: string): boolean {
  if (user.role === 'CE') return true;
  const zones = user.zones || [];
  if (zones.includes('ALL')) return true;
  return zones.includes(zone);
}
