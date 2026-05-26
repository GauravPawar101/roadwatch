declare module 'http-proxy-middleware' {
  import type { RequestHandler } from 'express';
  function createProxyMiddleware(options: any): RequestHandler;
  export { createProxyMiddleware };
}

export { };

