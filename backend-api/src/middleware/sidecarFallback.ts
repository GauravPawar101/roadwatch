import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { extractUserContext } from '../../../packages/sidecar-auth/dist/index.js';
import { validateJWT, validateServiceJWT } from './jwt.js';

/**
 * Permissive sidecar middleware:
 * - If a bearer token is present and is a service token (kind === 'service-access'), validate it
 * - Otherwise, attempt to validate a user JWT
 * - Always extract sidecar-provided user headers if available
 */
export function permissiveSidecarAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;

  // Helper to ensure we always extract user context if present
  const extractThen = (cb: () => void) => {
    try {
      extractUserContext(req, res, () => cb());
    } catch (e) {
      // non-fatal
      cb();
    }
  };

  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    // No bearer token: try extracting sidecar headers and then fall back to user JWT
    return extractThen(() => validateJWT(req, res, next));
  }

  const token = authHeader.slice('Bearer '.length);
  let decoded: any = null;
  try {
    decoded = jwt.decode(token) as any;
  } catch {}

  // If token looks like a service token, validate as service JWT and then extract headers
  if (decoded && decoded.kind === 'service-access') {
    return validateServiceJWT(req, res, (err?: any) => {
      if (err) return next(err);
      return extractThen(() => next());
    });
  }

  // Otherwise treat as user JWT
  return validateJWT(req, res, (err?: any) => {
    if (err) return next(err);
    return extractThen(() => next());
  });
}

export default permissiveSidecarAuth;
