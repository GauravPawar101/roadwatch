import { acquireDistributedBackpressurePermit } from '@roadwatch/redis';
import type { NextFunction, Request, Response } from 'express';

/**
 * Distributed rate-limiter middleware backed by Redis.
 *
 * Limits complaint POST submissions to 20 requests per 15-minute window per IP,
 * with a max of 5 concurrent in-flight requests per IP.
 *
 * Falls back gracefully: if Redis is not configured the import will throw at
 * acquireDistributedBackpressurePermit call time and we return 503.
 */
export async function rateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const permit = await acquireDistributedBackpressurePermit({
      scope: 'backend-api:complaints:post',
      principal: req.ip ?? 'unknown',
      maxRequestsPerWindow: 20,
      windowSeconds: 15 * 60,
      maxInflight: 5,
      inflightTtlSeconds: 120,
    });

    res.on('finish', () => {
      void permit.release();
    });

    next();
  } catch (error: unknown) {
    const statusCode =
      typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 503;
    const retryAfterSeconds =
      typeof (error as any)?.retryAfterSeconds === 'number'
        ? (error as any).retryAfterSeconds
        : 60;

    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(statusCode).json({
      error: statusCode === 429 ? 'Too many requests, please try again later.' : 'Service temporarily unavailable.',
      retryAfterSeconds,
    });
  }
}
