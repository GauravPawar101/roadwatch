import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function validateJWT(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  const token = auth.slice(7);
  try {
    // TODO: Use your public key or secret
    const payload = jwt.verify(token, process.env.JWT_PUBLIC_KEY || 'secret');
    (req as any).jwtPayload = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
