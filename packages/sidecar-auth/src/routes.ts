import express from 'express';
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
  iss: string;
  kind: 'service-access';
  target: string;
  address: string;
  method?: string;
  path?: string;
};

export type SidecarServiceRoutesOptions = {
  issuer?: string;
  serviceAuthSecret?: string;
  serviceRegistrySecret?: string;
};

function getServiceSecret(options?: SidecarServiceRoutesOptions): string {
  return (
    options?.serviceAuthSecret?.trim() ||
    process.env.SERVICE_AUTH_SECRET?.trim() ||
    process.env.ACCESS_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'local_development_cryptographic_secret'
  );
}

function getIssuer(options?: SidecarServiceRoutesOptions): string {
  return options?.issuer?.trim() || process.env.SERVICE_TOKEN_ISSUER?.trim() || 'roadwatch-gateway';
}

function getRegistrySecret(options?: SidecarServiceRoutesOptions): string | undefined {
  return options?.serviceRegistrySecret?.trim() || process.env.SERVICE_REGISTRY_SECRET?.trim() || undefined;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeAddress(address: string): string {
  return address.trim().replace(/\/$/, '');
}

function hasOwnObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRegistrationInput(body: unknown): ServiceRegistrationInput {
  if (!hasOwnObject(body)) {
    throw new Error('Invalid request body');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';

  if (!name) {
    throw new Error('Field "name" is required');
  }

  if (!address) {
    throw new Error('Field "address" is required');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(address);
  } catch {
    throw new Error('Field "address" must be a valid URL');
  }

  let healthUrl: string | undefined;
  if (body.healthUrl !== undefined) {
    if (typeof body.healthUrl !== 'string' || !body.healthUrl.trim()) {
      throw new Error('Field "healthUrl" must be a valid URL when provided');
    }
    try {
      healthUrl = new URL(body.healthUrl).toString();
    } catch {
      throw new Error('Field "healthUrl" must be a valid URL when provided');
    }
  }

  const description = typeof body.description === 'string' ? body.description.trim() || undefined : undefined;
  const metadata = hasOwnObject(body.metadata) ? body.metadata : undefined;

  return {
    name,
    address: parsedUrl.toString(),
    healthUrl,
    description,
    metadata
  };
}

function parseTokenRequestBody(body: unknown): { method?: string; path?: string; ttlSeconds?: number } {
  if (!hasOwnObject(body)) {
    return {};
  }

  const method = typeof body.method === 'string' ? body.method.trim().toUpperCase() : undefined;
  const path = typeof body.path === 'string' ? body.path.trim() : undefined;
  const ttlRaw = body.ttlSeconds;
  const ttlSeconds =
    typeof ttlRaw === 'number' && Number.isFinite(ttlRaw)
      ? Math.floor(ttlRaw)
      : typeof ttlRaw === 'string' && ttlRaw.trim()
        ? Number.parseInt(ttlRaw, 10)
        : undefined;

  if (ttlSeconds !== undefined && (Number.isNaN(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600)) {
    throw new Error('Field "ttlSeconds" must be between 30 and 3600');
  }

  return {
    method,
    path,
    ttlSeconds
  };
}

export function createServiceRegistry() {
  const serviceRegistry = new Map<string, RegisteredService>();

  function registerService(input: ServiceRegistrationInput): RegisteredService {
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

  function listRegisteredServices(): RegisteredService[] {
    return Array.from(serviceRegistry.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  function getRegisteredService(name: string): RegisteredService | null {
    return serviceRegistry.get(normalizeName(name)) ?? null;
  }

  return {
    registerService,
    listRegisteredServices,
    getRegisteredService
  };
}

export function signServiceRegistrationToken(
  service: RegisteredService,
  options?: SidecarServiceRoutesOptions
): string {
  return jwt.sign(
    {
      sub: service.name,
      aud: 'gateway',
      kind: 'service-registration',
      address: service.address
    } satisfies ServiceRegistrationClaims,
    getServiceSecret(options),
    {
      issuer: getIssuer(options),
      expiresIn: '24h'
    }
  );
}

export function verifyServiceRegistrationToken(token: string, options?: SidecarServiceRoutesOptions): ServiceRegistrationClaims {
  return jwt.verify(token, getServiceSecret(options), {
    audience: 'gateway',
    issuer: getIssuer(options)
  }) as ServiceRegistrationClaims;
}

export function signServiceAccessToken(
  callerService: string,
  targetService: string,
  targetAddress: string,
  options: {
    method?: string;
    path?: string;
    ttlSeconds?: number;
  } = {},
  routeOptions?: SidecarServiceRoutesOptions
): string {
  const ttl = Math.min(options.ttlSeconds || 300, 3600);
  const normalizedTarget = normalizeName(targetService);

  return jwt.sign(
    {
      sub: normalizeName(callerService),
      aud: normalizedTarget,
      iss: getIssuer(routeOptions),
      kind: 'service-access',
      target: normalizedTarget,
      address: normalizeAddress(targetAddress),
      method: options.method,
      path: options.path
    } satisfies ServiceAccessClaims,
    getServiceSecret(routeOptions),
    {
      expiresIn: `${ttl}s`
    }
  );
}

export function verifyServiceAccessToken(
  token: string,
  expectedAudience: string,
  options?: SidecarServiceRoutesOptions
): ServiceAccessClaims {
  return jwt.verify(token, getServiceSecret(options), {
    audience: normalizeName(expectedAudience),
    issuer: getIssuer(options)
  }) as ServiceAccessClaims;
}

export function createSidecarServiceRoutes(options: SidecarServiceRoutesOptions = {}) {
  const router = express.Router();
  const registry = createServiceRegistry();

  function requireRegistrySecret(req: any, res: any, next: any) {
    const expectedSecret = getRegistrySecret(options);
    if (!expectedSecret) {
      return next();
    }

    const providedSecret = req.header('x-service-registry-secret')?.trim();
    if (!providedSecret || providedSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized service registration' });
    }

    return next();
  }

  function requireServiceRegistration(req: any, res: any, next: any) {
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing service token' });
    }

    const token = authHeader.slice('Bearer '.length);
    try {
      const claims = verifyServiceRegistrationToken(token, options);
      (req as { serviceIdentity?: ServiceRegistrationClaims }).serviceIdentity = claims;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid service token' });
    }
  }

  router.post('/register', requireRegistrySecret, (req: any, res: any) => {
    try {
      const input = parseRegistrationInput(req.body);
      const service = registry.registerService(input);
      const registrationToken = signServiceRegistrationToken(service, options);
      return res.status(201).json({ service, registrationToken });
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error instanceof Error ? error.message : 'Unknown validation error'
      });
    }
  });

  router.get('/', requireServiceRegistration, (_req: any, res: any) => {
    return res.json({ services: registry.listRegisteredServices() });
  });

  router.get('/:serviceName', requireServiceRegistration, (req: any, res: any) => {
    const serviceName = String(req.params.serviceName);
    const service = registry.getRegisteredService(serviceName);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    return res.json({ service });
  });

  router.post('/:serviceName/token', requireServiceRegistration, (req: any, res: any) => {
    try {
      const targetService = String(req.params.serviceName);
      const callerService = (req as { serviceIdentity?: ServiceRegistrationClaims }).serviceIdentity?.sub;

      if (!callerService) {
        return res.status(401).json({ error: 'Invalid service identity' });
      }

      const target = registry.getRegisteredService(targetService);
      if (!target) {
        return res.status(404).json({ error: 'Target service not found' });
      }

      const tokenRequest = parseTokenRequestBody(req.body);
      const token = signServiceAccessToken(
        callerService,
        targetService,
        target.address,
        {
          method: tokenRequest.method,
          path: tokenRequest.path,
          ttlSeconds: tokenRequest.ttlSeconds
        },
        options
      );

      return res.json({
        service: target,
        token,
        expiresIn: tokenRequest.ttlSeconds || 300
      });
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid token request',
        details: error instanceof Error ? error.message : 'Unknown validation error'
      });
    }
  });

  return router;
}
