import jwt from 'jsonwebtoken';

export type ServiceJwtPayload = {
  sub: string;
  aud: string;
  iss: string;
  kind: 'service-access';
  target: string;
  address: string;
  method?: string;
  path?: string;
};

export type UserContext = {
  id: string;
  role: string;
  phone?: string;
  phoneHash?: string;
  districts?: string[];
  zones?: string[];
};

export type AuthenticatedRequest = Request & {
  serviceAuth: ServiceJwtPayload;
  userContext?: UserContext;
};

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

function getServiceSecret(): string {
  return (
    process.env.SERVICE_AUTH_SECRET?.trim() ||
    process.env.ACCESS_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'local_development_cryptographic_secret'
  );
}

function getServiceName(): string {
  return process.env.SERVICE_NAME || 'unknown-service';
}

/**
 * Middleware to validate service-to-service JWT tokens issued by the gateway
 */
export function validateServiceAuth(req: any, res: any, next: any) {
  const authHeader = getHeaderValue((req.headers as any) || {}, 'authorization');
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Missing service authentication token',
      code: 'MISSING_SERVICE_TOKEN'
    });
  }

  const token = authHeader.slice('Bearer '.length);
  const serviceName = getServiceName();

  try {
    const payload = jwt.verify(token, getServiceSecret(), {
      audience: serviceName,
      issuer: 'roadwatch-gateway'
    }) as ServiceJwtPayload;

    if (payload.kind !== 'service-access' || payload.target !== serviceName) {
      return res.status(401).json({ 
        error: 'Invalid service token scope',
        code: 'INVALID_SERVICE_SCOPE'
      });
    }

    // Validate method and path if specified in token
    if (payload.method && payload.method.toUpperCase() !== String(req.method || '').toUpperCase()) {
      return res.status(403).json({
        error: `Method ${req.method} not allowed, token is for ${payload.method}`,
        code: 'METHOD_NOT_ALLOWED'
      });
    }

    if (payload.path && !((req as any).path || '').startsWith(payload.path)) {
      return res.status(403).json({
        error: `Path ${req.path} not allowed, token is for ${payload.path}`,
        code: 'PATH_NOT_ALLOWED'
      });
    }

    (req as AuthenticatedRequest).serviceAuth = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ 
        error: 'Service token expired',
        code: 'SERVICE_TOKEN_EXPIRED'
      });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ 
        error: 'Invalid service token',
        code: 'INVALID_SERVICE_TOKEN'
      });
    }
    return res.status(401).json({ 
      error: 'Service authentication failed',
      code: 'SERVICE_AUTH_FAILED'
    });
  }
}

/**
 * Middleware to extract user context from headers (set by gateway proxy)
 */
export function extractUserContext(req: any, res: any, next: any) {
  const headers = (req.headers as any) || {};
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

/**
 * Combined middleware for service authentication and user context extraction
 */
export function sidecarAuth(req: any, res: any, next: any) {
  validateServiceAuth(req, res, (err: any) => {
    if (err) return next(err);
    extractUserContext(req, res, next);
  });
}

/**
 * Optional middleware variant:
 * - If a valid service token is present, validates and extracts user context.
 * - If no bearer token is present, only extracts user context.
 * - If bearer token is present but invalid, returns 401.
 */
export function optionalSidecarAuth(req: any, res: any, next: any) {
  const authHeader = getHeaderValue((req.headers as any) || {}, 'authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return extractUserContext(req, res, next);
  }

  return sidecarAuth(req, res, next);
}

/**
 * Middleware to require user context (for endpoints that need user information)
 */
export function requireUserContext(req: any, res: any, next: any) {
  const userContext = (req as AuthenticatedRequest).userContext;
  if (!userContext) {
    return res.status(401).json({
      error: 'User context required but not provided',
      code: 'MISSING_USER_CONTEXT'
    });
  }
  next();
}

/**
 * Middleware to require specific user roles
 */
export function requireUserRole(allowedRoles: string[]) {
  return (req: any, res: any, next: any) => {
    const userContext = (req as AuthenticatedRequest).userContext;
    if (!userContext) {
      return res.status(401).json({
        error: 'User context required for role check',
        code: 'MISSING_USER_CONTEXT'
      });
    }

    if (!allowedRoles.includes(userContext.role)) {
      return res.status(403).json({
        error: `Role ${userContext.role} not allowed. Required: ${allowedRoles.join(', ')}`,
        code: 'INSUFFICIENT_ROLE'
      });
    }

    next();
  };
}