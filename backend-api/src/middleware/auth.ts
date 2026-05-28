import { NextFunction, Request, Response } from 'express';
import { validateJWT } from './jwt.js';

/**
 * Map external role strings (gateway / sidecar / JWT) to canonical RBAC roles
 */
function mapToCanonicalRole(raw?: string | null): 'admin' | 'authority' | 'contractor' | 'citizen' {
  if (!raw) return 'citizen';
  const r = String(raw).trim().toUpperCase();
  if (r === 'ADMIN' || r === 'SUPERADMIN') return 'admin';
  if (r === 'CE' || r === 'EE' || r === 'AUTHORITY') return 'authority';
  if (r === 'CONTRACTOR' || r === 'CONTRACTOR_ROLE') return 'contractor';
  return 'citizen';
}

/**
 * Attach a normalized `req.user` object so RBAC helpers can rely on a
 * consistent shape regardless of whether the request used sidecar headers or
 * a bearer JWT.
 */
function attachNormalizedUser(req: Request, opts: { id?: string; rawRole?: string | null; districts?: any } = {}) {
  const id = opts.id || (req as any).userId || (req as any).userContext?.id || null;
  const rawRole = opts.rawRole || (req as any).userRole || (req as any).userContext?.role || null;
  const canonical = mapToCanonicalRole(rawRole);

  (req as any).user = {
    id,
    roles: [canonical],
    authority_jurisdiction: (req as any).userContext?.districts || opts.districts || (req as any).jwtPayload?.districts || undefined
  };

  // Keep backward-compatible quick accessors
  (req as any).userId = id;
  (req as any).userRole = rawRole;
}

/**
 * Ensure the request is authenticated either via sidecar-provided user context
 * or via a bearer JWT. Normalizes `req.user` for RBAC middleware.
 */
export function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  // Sidecar user context already extracted by sidecarAuth
  const userContext = (req as any).userContext;
  if (userContext && userContext.id) {
    attachNormalizedUser(req, { id: userContext.id, rawRole: userContext.role, districts: userContext.districts });
    return next();
  }

  // Fallback to validating an incoming JWT directly
  return validateJWT(req, res, (err?: any) => {
    if (err) return next(err);
    // validateJWT attaches `userId` and `userRole` already
    if (!(req as any).userId) {
      return res.status(401).json({ error: 'Authenticated user id not found' });
    }
    attachNormalizedUser(req, { id: (req as any).userId, rawRole: (req as any).userRole });
    return next();
  });
}

export function requireRole(requiredRole: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roleRaw = (req as any).userRole || (req as any).userContext?.role;
    const canonical = mapToCanonicalRole(roleRaw);
    if (!roleRaw) {
      return res.status(403).json({ error: 'No role assigned to user', code: 'NO_ROLE' });
    }
    if (canonical !== requiredRole) {
      return res.status(403).json({ error: `Required role: ${requiredRole}, user role: ${canonical}`, code: 'INSUFFICIENT_ROLE' });
    }
    next();
  };
}
