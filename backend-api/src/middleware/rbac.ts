import type { NextFunction, Request, Response } from 'express-serve-static-core';

/**
 * RBAC Middleware
 * Enforce role-based access control on routes
 */

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    roles: string[];
    authority_jurisdiction?: string[];
  };
}

export type UserRole = 'admin' | 'authority' | 'contractor' | 'citizen';

/**
 * Middleware: Check if user has required role
 */
export function validateRole(...requiredRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userRoles = user.roles || [];
    const hasRole = requiredRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({
        error: `Forbidden: requires one of roles: ${requiredRoles.join(', ')}`,
      });
    }

    next();
  };
}

/**
 * Middleware: Validate admin-only access
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return validateRole('admin')(req, res, next);
}

/**
 * Middleware: Validate authority-level access
 */
export function requireAuthority(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return validateRole('admin', 'authority')(req, res, next);
}

/**
 * Middleware: Validate citizen-level access (everyone)
 */
export function requireCitizen(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * Check jurisdiction access for authority users
 */
export function checkJurisdictionAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = req.user;

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Admin can access everything
  if (user.roles?.includes('admin')) {
    return next();
  }

  // Authority must have jurisdiction specified
  if ((user.roles?.includes('authority') || user.roles?.includes('contractor')) && !user.authority_jurisdiction) {
    return res.status(403).json({ error: 'User missing jurisdiction assignment' });
  }

  next();
}

/**
 * Middleware: Audit all access
 */
export function auditAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Accept either normalized `req.user` or sidecar-provided `req.userContext`
  const reqAny = req as any;
  const user = req.user ?? (reqAny.userContext ? {
    id: reqAny.userContext.id,
    roles: [reqAny.userContext.role],
    authority_jurisdiction: reqAny.userContext.districts
  } : undefined);

  if (!user) return next();

  // Log access in background (don't block request)
  setImmediate(() => {
    // In production, persist to a database or structured logger
    console.log({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      roles: user.roles,
      method: reqAny.method,
      path: reqAny.path,
      ip_address: reqAny.ip,
      user_agent: reqAny.get?.('user-agent')
    });
  });

  next();
}
