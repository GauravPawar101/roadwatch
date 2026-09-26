import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { Router, makeAsyncSafe, wrapAsyncHandler } from './async-router';

const servers: Array<{ close: (cb: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve()))),
  );
});

/** Boots an app on an ephemeral port and returns a fetch helper for it. */
async function serve(app: express.Express) {
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}${path}`, init);
}

describe('Router (async-safe)', () => {
  it('turns an async rejection into a 500 instead of an unhandled rejection', async () => {
    const app = makeAsyncSafe(express());
    const router = Router();
    router.get('/boom', async () => {
      throw new Error('handler exploded');
    });
    app.use(router);
    app.use(((err: Error, _req, res, next) => {
      res.status(500).json({ error: err.message });
    }) as express.ErrorRequestHandler);

    const request = await serve(app);
    const res = await request('/boom');

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('handler exploded');
  });

  it('turns a synchronous throw into a 500 as well', async () => {
    const app = makeAsyncSafe(express());
    const router = Router();
    router.get('/sync', () => {
      throw new Error('sync boom');
    });
    app.use(router);
    app.use(((err: Error, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    }) as express.ErrorRequestHandler);

    const res = await (await serve(app))('/sync');

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('sync boom');
  });

  /**
   * Express decides that a layer is error middleware purely from
   * `fn.length === 4`. If wrapping collapsed every handler to three declared
   * parameters, error middleware would be treated as ordinary middleware and
   * would never run — turning this fix into an outage.
   */
  it('keeps 4-arity error middleware recognisable as error middleware', async () => {
    const app = makeAsyncSafe(express());
    const router = Router();
    const onError = vi.fn((err: Error, _req, res, _next) => {
      res.status(503).json({ error: err.message });
    });
    expect(onError.length).toBe(4);

    router.get('/fail', async () => {
      throw new Error('kaboom');
    });
    app.use(router);
    app.use(wrapAsyncHandler(onError as never) as express.ErrorRequestHandler);

    const res = await (await serve(app))('/fail');

    expect(onError).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
  });

  it('passes a successful async handler through untouched', async () => {
    const app = makeAsyncSafe(express());
    const router = Router();
    router.get('/ok', async (_req, res) => {
      res.json({ ok: true });
    });
    app.use(router);

    const res = await (await serve(app))('/ok');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('catches rejections from router-level middleware registered via use()', async () => {
    const app = makeAsyncSafe(express());
    const router = Router();
    router.use(async (_req, res, next) => {
      await Promise.resolve();
      throw new Error('middleware boom');
    });
    router.get('/deep', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(router);
    app.use(((err: Error, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    }) as express.ErrorRequestHandler);

    const res = await (await serve(app))('/deep');

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('middleware boom');
  });

  it('forwards an explicit next(err) from an async handler', async () => {
    const app = makeAsyncSafe(express());
    const router = Router();
    router.get('/next', async (_req, _res, next) => {
      next(new Error('explicit next'));
    });
    app.use(router);
    app.use(((err: Error, _req, res, _next) => {
      res.status(400).json({ error: err.message });
    }) as express.ErrorRequestHandler);

    const res = await (await serve(app))('/next');

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('explicit next');
  });

  it('does not wrap a handler twice, so a rejection is reported once', async () => {
    const onError = vi.fn((err: Error, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    });
    const app = makeAsyncSafe(express());
    const router = Router();
    router.get('/once', async () => {
      throw new Error('single report');
    });
    // Same router, registered on two paths: the handler is wrapped once and
    // then re-wrapped if wrapping were not idempotent.
    router.get('/twice', router.stack.find(l => l.route?.path === '/once')!.route!.stack[0]!.handle as never);
    app.use(router);
    app.use(wrapAsyncHandler(onError as never) as express.ErrorRequestHandler);

    const request = await serve(app);
    const res = await request('/once');

    expect(onError).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
  });

  it('covers app-level handlers, not just router routes', async () => {
    const application = makeAsyncSafe(express());
    application.get('/app-level', async () => {
      throw new Error('app handler exploded');
    });
    application.use(((err: Error, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    }) as express.ErrorRequestHandler);

    const res = await (await serve(application))('/app-level');

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('app handler exploded');
  });

  it('propagates a rejection thrown by async error middleware', async () => {
    const app = makeAsyncSafe(express());
    const router = Router();
    router.get('/bad-error-mw', async () => {
      throw new Error('original');
    });
    app.use(router);
    // Must declare four parameters to be error middleware to Express at all.
    app.use(async (
      err: unknown,
      _req: express.Request,
      _res: express.Response,
      _next: express.NextFunction,
    ) => {
      void err;
      throw new Error('error handler failed');
    });
    app.use(((err: Error, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    }) as express.ErrorRequestHandler);

    const res = await (await serve(app))('/bad-error-mw');

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('error handler failed');
  });
});

describe('wrapAsyncHandler', () => {
  it('leaves an already-wrapped handler identical', () => {
    const original = () => {};
    const once = wrapAsyncHandler(original);
    expect(wrapAsyncHandler(once)).toBe(once);
  });

  it('returns non-function values unchanged', () => {
    expect(wrapAsyncHandler(undefined as never)).toBeUndefined();
  });
});
