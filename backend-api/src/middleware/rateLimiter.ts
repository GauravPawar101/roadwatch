// Provide a minimal ambient declaration to satisfy TypeScript when
// the @types/express-rate-limit package is not installed.
declare module 'express-rate-limit' {
  type Options = any;
  const rateLimit: (opts?: Options) => any;
  export default rateLimit;
}

import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
});
