import type { NextFunction, Request, Response } from 'express-serve-static-core';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
}
