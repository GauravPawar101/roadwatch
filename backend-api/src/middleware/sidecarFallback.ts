import type { NextFunction, Request, Response } from 'express-serve-static-core';
import { extractUserContext } from './userContext.js';
import { validateJWT } from './jwt.js';

/**
 * Request auth for backend routes (post sidecar-auth removal):
 * - Prefer gateway-forwarded X-User-* headers when present
 * - Otherwise validate a user JWT bearer token
 * Service-access JWTs are no longer used; mesh mTLS covers service identity in k8s.
 */
export function permissiveSidecarAuth(req: Request, res: Response, next: NextFunction) {
  extractUserContext(req, res, () => {
    if ((req as any).userContext?.id) {
      return next();
    }
    return validateJWT(req, res, next);
  });
}

export default permissiveSidecarAuth;
