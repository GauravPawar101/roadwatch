import type { NextFunction, Request, Response } from 'express-serve-static-core';

export type UserContext = {
  id: string;
  role: string;
  phone?: string;
  phoneHash?: string;
  districts?: string[];
  zones?: string[];
};

export interface AuthenticatedRequest extends Request {
  userContext?: UserContext;
  userId?: string;
  userRole?: string;
}

function getHeaderValue(headers: Record<string, unknown>, key: string): string | undefined {
  const direct = headers[key];
  if (typeof direct === 'string') return direct;

  const lower = headers[key.toLowerCase()];
  if (typeof lower === 'string') return lower;

  const upper = headers[key.toUpperCase()];
  if (typeof upper === 'string') return upper;

  return undefined;
}

function parseJsonArrayHeader(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract user context from gateway-forwarded X-User-* headers (mesh / trusted hop).
 */
export function extractUserContext(req: Request, _res: Response, next: NextFunction) {
  const headers = (req.headers as Record<string, unknown>) || {};
  const userId = getHeaderValue(headers, 'x-user-id');
  const userRole = getHeaderValue(headers, 'x-user-role');
  const userPhone = getHeaderValue(headers, 'x-user-phone');
  const userPhoneHash = getHeaderValue(headers, 'x-user-phone-hash');
  const userDistricts = getHeaderValue(headers, 'x-user-districts');
  const userZones = getHeaderValue(headers, 'x-user-zones');

  if (userId && userRole) {
    (req as AuthenticatedRequest).userContext = {
      id: userId,
      role: userRole,
      phone: userPhone || undefined,
      phoneHash: userPhoneHash || undefined,
      districts: parseJsonArrayHeader(userDistricts),
      zones: parseJsonArrayHeader(userZones)
    };
  }

  next();
}

export function requireUserContext(req: Request, res: Response, next: NextFunction) {
  const userContext = (req as AuthenticatedRequest).userContext;
  if (!userContext?.id) {
    return res.status(401).json({
      error: 'User context required but not provided',
      code: 'MISSING_USER_CONTEXT'
    });
  }
  next();
}
