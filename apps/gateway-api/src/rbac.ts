import type { Request, Response, NextFunction } from 'express';
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
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // SSE cannot send Authorization header with EventSource; support token query.
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (token) {
    try {
      (req as AuthedRequest).user = verifyAccessToken(token);
      return next();
    } catch {
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
  if (user.districts.includes('ALL')) return true;
  return user.districts.includes(district);
}

export function assertZoneAccess(user: JwtClaims, zone: string): boolean {
  if (user.role === 'CE') return true;
  if (user.zones.includes('ALL')) return true;
  return user.zones.includes(zone);
}
