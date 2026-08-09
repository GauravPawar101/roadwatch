import type { NextFunction, Request, Response } from 'express-serve-static-core';
import * as fs from 'fs';
import jwt from 'jsonwebtoken';

interface JWTPayload {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  userId?: string;
  role?: string;
  permissions?: string[];
}

/**
 * Get JWT public key for verification
 */
function getJWTPublicKey(): string {
  // Try to load from file first
  const publicKeyPath = process.env.JWT_PUBLIC_KEY_PATH;
  if (publicKeyPath && fs.existsSync(publicKeyPath)) {
    return fs.readFileSync(publicKeyPath, 'utf8');
  }
  
  // Try environment variable
  const publicKeyEnv = process.env.JWT_PUBLIC_KEY;
  if (publicKeyEnv) {
    // Handle base64 encoded keys
    if (publicKeyEnv.startsWith('LS0t')) { // Base64 encoded PEM
      return Buffer.from(publicKeyEnv, 'base64').toString('utf8');
    }
    return publicKeyEnv;
  }
  
  // Fallback to secret (for development only)
  const secret = process.env.JWT_SECRET || process.env.ACCESS_SECRET;
  if (secret) {
    console.warn('[JWT] Using shared secret for JWT verification. Use RSA keys in production.');
    return secret;
  }
  
  throw new Error('No JWT public key or secret configured');
}

/**
 * Validate JWT token and extract payload
 */
export function validateJWT(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Missing or invalid token',
      code: 'MISSING_TOKEN'
    });
  }
  
  const token = auth.slice(7);
  
  try {
    const publicKey = getJWTPublicKey();
    
    // Determine algorithm based on key type
    const algorithm = publicKey.includes('BEGIN') ? 'RS256' : 'HS256';
    
    const payload = jwt.verify(token, publicKey, {
      algorithms: [algorithm],
      audience: process.env.JWT_AUDIENCE || 'roadwatch-api',
      issuer: process.env.JWT_ISSUER || 'roadwatch-auth'
    }) as JWTPayload;
    
    // Validate token structure
    if (!payload.sub) {
      return res.status(401).json({ 
        error: 'Invalid token structure: missing subject',
        code: 'INVALID_TOKEN_STRUCTURE'
      });
    }
    
    // Check token expiration (additional check)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return res.status(401).json({ 
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    // Attach payload to request
    (req as any).jwtPayload = payload;
    (req as any).userId = payload.userId || payload.sub;
    (req as any).userRole = payload.role;
    (req as any).userPermissions = payload.permissions || [];
    
    console.log(`[JWT] Authenticated user: ${payload.sub} with role: ${payload.role || 'none'}`);
    next();
    
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    console.error('[JWT] Token validation failed:', err.message ?? error);
    
    let errorCode = 'INVALID_TOKEN';
    let errorMessage = 'Invalid token';
    
    if (err.name === 'TokenExpiredError') {
      errorCode = 'TOKEN_EXPIRED';
      errorMessage = 'Token has expired';
    } else if (err.name === 'JsonWebTokenError') {
      errorCode = 'MALFORMED_TOKEN';
      errorMessage = 'Malformed token';
    } else if (err.name === 'NotBeforeError') {
      errorCode = 'TOKEN_NOT_ACTIVE';
      errorMessage = 'Token not active yet';
    }
    
    return res.status(401).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
}

/**
 * Middleware to check if user has required role
 */
export function requireRole(requiredRole: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).userRole;
    
    if (!userRole) {
      return res.status(403).json({ 
        error: 'No role assigned to user',
        code: 'NO_ROLE'
      });
    }
    
    if (userRole !== requiredRole) {
      return res.status(403).json({ 
        error: `Required role: ${requiredRole}, user role: ${userRole}`,
        code: 'INSUFFICIENT_ROLE'
      });
    }
    
    next();
  };
}

/**
 * Middleware to check if user has required permission
 */
export function requirePermission(requiredPermission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userPermissions = (req as any).userPermissions || [];
    
    if (!userPermissions.includes(requiredPermission)) {
      return res.status(403).json({ 
        error: `Required permission: ${requiredPermission}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }
    
    next();
  };
}

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

function getServiceSecret(): string {
  return process.env.SERVICE_AUTH_SECRET || process.env.JWT_SECRET || process.env.ACCESS_SECRET || 'secret';
}

function getServiceName(): string {
  return process.env.SERVICE_NAME || 'backend-api';
}

export function validateServiceJWT(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid service token' });
  }

  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, getServiceSecret(), {
      audience: getServiceName(),
      issuer: 'roadwatch-gateway'
    }) as ServiceJwtPayload;

    if (payload.kind !== 'service-access' || payload.target !== getServiceName()) {
      return res.status(401).json({ error: 'Invalid service token' });
    }

    (req as any).serviceJwtPayload = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid service token' });
  }
}
