import express from 'express';
import { z } from 'zod';
import {
    getRegisteredService,
    listRegisteredServices,
    registerService,
    signServiceAccessToken,
    signServiceRegistrationToken,
    verifyServiceRegistrationToken
} from '../services/discovery.js';

const router = express.Router();

// Middleware to verify service registration token
function requireServiceRegistration(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing service registration token' });
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const claims = verifyServiceRegistrationToken(token);
    (req as any).serviceClaims = claims;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid service registration token' });
  }
}

// Register a new service
router.post('/register', async (req, res) => {
  try {
    const input = z.object({
      name: z.string().min(1),
      address: z.string().url(),
      healthUrl: z.string().url().optional(),
      description: z.string().optional(),
      metadata: z.record(z.unknown()).optional()
    }).parse(req.body);

    const service = registerService(input);
    const token = signServiceRegistrationToken(service);

    res.status(201).json({
      service,
      registrationToken: token
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to register service' });
  }
});

// List all registered services (requires service registration token)
router.get('/', requireServiceRegistration, (req, res) => {
  const services = listRegisteredServices();
  res.json({ services });
});

// Get specific service details (requires service registration token)
router.get('/:serviceName', requireServiceRegistration, (req, res) => {
  const serviceName = String(req.params.serviceName);
  const service = getRegisteredService(serviceName);
  
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }

  res.json({ service });
});

// Request access token for service-to-service communication
router.post('/:serviceName/token', requireServiceRegistration, (req, res) => {
  try {
    const targetService = String(req.params.serviceName);
    const callerService = (req as any).serviceClaims.sub;
    
    const body = z.object({
      method: z.string().optional(),
      path: z.string().optional(),
      ttlSeconds: z.number().min(30).max(3600).optional()
    }).parse(req.body);

    const service = getRegisteredService(targetService);
    if (!service) {
      return res.status(404).json({ error: 'Target service not found' });
    }

    const token = signServiceAccessToken(callerService, targetService, body);

    res.json({
      service,
      token,
      expiresIn: body.ttlSeconds || 300
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to generate service access token' });
  }
});

export default router;