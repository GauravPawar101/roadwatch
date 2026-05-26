import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export type ServiceRegistrationInput = {
  name: string;
  address: string;
  healthUrl?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type RegisteredService = ServiceRegistrationInput & {
  registeredAt: string;
  updatedAt: string;
};

export type ServiceRegistrationClaims = {
  sub: string;
  aud: 'gateway';
  kind: 'service-registration';
  address: string;
};

export type ServiceAccessClaims = {
  sub: string;
  aud: string;
  iss: 'roadwatch-gateway';
  kind: 'service-access';
  target: string;
  address: string;
  method?: string;
  path?: string;
};

const serviceRegistry = new Map<string, RegisteredService>();

function getServiceSecret(): string {
  return (
    process.env.SERVICE_AUTH_SECRET?.trim() ||
    process.env.ACCESS_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'local_development_cryptographic_secret'
  );
}

function getRegistrySecret(): string | undefined {
  return process.env.SERVICE_REGISTRY_SECRET?.trim() || undefined;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeAddress(address: string): string {
  return address.trim().replace(/\/$/, '');
}

export function registerService(input: ServiceRegistrationInput): RegisteredService {
  const name = normalizeName(input.name);
  const address = normalizeAddress(input.address);
  const now = new Date().toISOString();

  const service: RegisteredService = {
    name,
    address,
    healthUrl: input.healthUrl?.trim() || undefined,
    description: input.description?.trim() || undefined,
    metadata: input.metadata ?? {},
    registeredAt: serviceRegistry.get(name)?.registeredAt ?? now,
    updatedAt: now
  };

  serviceRegistry.set(name, service);
  return service;
}

export function listRegisteredServices(): RegisteredService[] {
  return Array.from(serviceRegistry.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function getRegisteredService(name: string): RegisteredService | null {
  return serviceRegistry.get(normalizeName(name)) ?? null;
}

export function signServiceRegistrationToken(service: RegisteredService): string {
  return jwt.sign(
    {
      sub: service.name,
      aud: 'gateway',
      kind: 'service-registration',
      address: service.address
    } satisfies ServiceRegistrationClaims,
    getServiceSecret(),
    {
      issuer: 'roadwatch-gateway',
      expiresIn: '24h'
    }
  );
}

export function signServiceAccessToken(
  callerService: string,
  targetService: string,
  options: {
    method?: string;
    path?: string;
    ttlSeconds?: number;
  } = {}
): string {
  const targetServiceInfo = getRegisteredService(targetService);
  if (!targetServiceInfo) {
    throw new Error(`Target service '${targetService}' not found in registry`);
  }

  const ttl = Math.min(options.ttlSeconds || 300, 3600); // Default 5min, max 1hr
  
  return jwt.sign(
    {
      sub: callerService,
      aud: targetService,
      iss: 'roadwatch-gateway',
      kind: 'service-access',
      target: targetService,
      address: targetServiceInfo.address,
      method: options.method,
      path: options.path
    } satisfies ServiceAccessClaims,
    getServiceSecret(),
    {
      expiresIn: `${ttl}s`
    }
  );
}

export function verifyServiceRegistrationToken(token: string): ServiceRegistrationClaims {
  return jwt.verify(token, getServiceSecret(), {
    audience: 'gateway',
    issuer: 'roadwatch-gateway'
  }) as ServiceRegistrationClaims;
}

export function verifyServiceAccessToken(token: string, expectedAudience: string): ServiceAccessClaims {
  return jwt.verify(token, getServiceSecret(), {
    audience: expectedAudience,
    issuer: 'roadwatch-gateway'
  }) as ServiceAccessClaims;
}

export function requireRegistrySecret(req: Request, res: Response, next: NextFunction): Response | void {
  const expectedSecret = getRegistrySecret();
  if (!expectedSecret) return next();

  const providedSecret = req.header('x-service-registry-secret')?.trim();
  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized service registration' });
  }

  return next();
}

export function requireServiceRegistration(req: Request, res: Response, next: NextFunction): Response | void {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing service token' });
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const claims = verifyServiceRegistrationToken(token);
    (req as Request & { serviceIdentity?: ServiceRegistrationClaims }).serviceIdentity = claims;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid service token' });
  }
}

export async function registerServiceWithGateway(input: {
  gatewayUrl: string;
  service: ServiceRegistrationInput;
  registrySecret?: string;
}): Promise<{ service: RegisteredService; registrationToken: string }> {
  const response = await fetch(`${input.gatewayUrl.replace(/\/$/, '')}/services/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.registrySecret ? { 'x-service-registry-secret': input.registrySecret } : {})
    },
    body: JSON.stringify(input.service)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Service registration failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<{ service: RegisteredService; registrationToken: string }>;
}

export async function requestServiceAccessToken(input: {
  gatewayUrl: string;
  registrationToken: string;
  targetService: string;
  method?: string;
  path?: string;
  ttlSeconds?: number;
}): Promise<{ service: RegisteredService; token: string }> {
  const response = await fetch(
    `${input.gatewayUrl.replace(/\/$/, '')}/services/${encodeURIComponent(input.targetService)}/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.registrationToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        method: input.method,
        path: input.path,
        ttlSeconds: input.ttlSeconds
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Service authorization failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<{ service: RegisteredService; token: string }>;
}
