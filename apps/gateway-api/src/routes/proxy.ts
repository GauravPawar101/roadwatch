import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { requireAuth, type AuthedRequest } from '../rbac.js';
import { getRegisteredService, signServiceAccessToken } from '../services/discovery.js';

const router = express.Router();

// Proxy requests to registered services with authentication
router.use('/:serviceName/*', requireAuth, async (req, res, next) => {
  const serviceName = String(req.params.serviceName);
  const service = getRegisteredService(serviceName);

  if (!service) {
    return res.status(404).json({ error: `Service '${serviceName}' not found` });
  }

  if (!service.address) {
    return res.status(502).json({ error: `Service '${serviceName}' has no address configured` });
  }

  const serviceToken = signServiceAccessToken('gateway', serviceName, {
    method: String(req.method),
    path: String(req.path),
    ttlSeconds: 300,
  });

  const proxy = createProxyMiddleware({
    target: String(service.address),
    changeOrigin: true,
    pathRewrite: {
      [`^/proxy/${serviceName}`]: '',
    },
    onProxyReq: (proxyReq: any, req: any, _res: any) => {
      proxyReq.setHeader('Authorization', `Bearer ${serviceToken}`);

      const user = (req as AuthedRequest).user;
      proxyReq.setHeader('X-User-ID', user.sub);
      proxyReq.setHeader('X-User-Role', user.role);
      if (user.phone)      proxyReq.setHeader('X-User-Phone',      user.phone);
      if (user.phoneHash)  proxyReq.setHeader('X-User-Phone-Hash', user.phoneHash);
      if (user.districts)  proxyReq.setHeader('X-User-Districts',  JSON.stringify(user.districts));
      if (user.zones)      proxyReq.setHeader('X-User-Zones',      JSON.stringify(user.zones));
    },
    onError: (err: any, _req: any, res: any) => {
      console.error(`Proxy error for service ${serviceName}:`, err);
      res.status(502).json({ error: 'Service unavailable' });
    },
  } as any);

  proxy(req, res, next);
});

export default router;