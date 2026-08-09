import { requireUserContext, requireUserRole, validateServiceAuth, type AuthenticatedRequest } from '@roadwatch/sidecar-auth';
import express from 'express';
import type { Response } from 'express-serve-static-core';

const router = express.Router();

// Example route that requires user context (any authenticated user)
router.get('/profile', requireUserContext, (req: AuthenticatedRequest, res: Response) => {
  const { userContext } = req;
  
  res.json({
    message: 'User profile accessed via sidecar auth',
    user: {
      id: userContext!.id,
      role: userContext!.role,
      phone: userContext!.phone,
      districts: userContext!.districts,
      zones: userContext!.zones
    }
  });
});

// Example route that requires specific roles
router.get('/authority-only', requireUserRole(['CE', 'EE']), (req: AuthenticatedRequest, res: Response) => {
  const { userContext, serviceAuth } = req;
  
  res.json({
    message: 'Authority-only endpoint accessed',
    user: userContext,
    serviceInfo: {
      caller: serviceAuth.sub,
      target: serviceAuth.target,
      method: serviceAuth.method,
      path: serviceAuth.path
    }
  });
});

// Example route that works with service-to-service calls (no user context required)
router.get('/service-info', validateServiceAuth, (req: AuthenticatedRequest, res: Response) => {
  const { serviceAuth, userContext } = req;
  
  res.json({
    message: 'Service information',
    serviceAuth: {
      caller: serviceAuth.sub,
      target: serviceAuth.target,
      address: serviceAuth.address
    },
    hasUserContext: !!userContext,
    userContext: userContext || null
  });
});

// Example route for contractors only
router.post('/contractor-action', requireUserRole(['CONTRACTOR']), (req: AuthenticatedRequest, res: Response) => {
  const { userContext } = req;
  
  res.json({
    message: 'Contractor action performed',
    contractorId: userContext!.id,
    districts: userContext!.districts
  });
});

export default router;