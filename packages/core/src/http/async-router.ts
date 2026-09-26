import express from 'express';

/**
 * Express 4 does not catch rejections from async route handlers. A handler
 * declared `async (req, res) => { ... }` returns a promise; if it throws, the
 * rejection escapes Express entirely, so the request never gets a response and
 * the process sees an unhandled rejection.
 *
 * That is not hypothetical here: a JWT whose `sub` was not a UUID reached
 * Postgres, aborted the surrounding transaction, and the gateway both hung the
 * request and terminated. All 44 route handlers in this gateway are async.
 *
 * `Router()` below returns an ordinary Express router whose registered
 * handlers are wrapped so that both synchronous throws and async rejections are
 * forwarded to `next(err)`, which is what lets the error middleware respond.
 *
 * The express *types* are deliberately not imported by name. This package is
 * consumed by apps that compile its source directly (see the `paths` mapping in
 * each tsconfig), under three different module resolutions, and
 * `import type { Request } from 'express'` fails to resolve in some of them.
 * Deriving types from the default import resolves everywhere because `express`
 * itself is a real dependency of every consumer.
 */

type AnyHandler = (...args: any[]) => unknown;

type NextFn = (err?: unknown) => void;

/** The Express router type, derived rather than imported by name. */
export type ExpressRouterType = ReturnType<typeof express.Router>;

/** Marks an already-wrapped handler so it is never wrapped twice. */
const WRAPPED = Symbol.for('roadwatch.asyncHandler.wrapped');

/** Marks a registration method that has already been patched. */
const PATCHED = Symbol.for('roadwatch.asyncHandler.methodPatched');

function isWrapped(fn: AnyHandler): boolean {
  return (fn as unknown as Record<symbol, unknown>)[WRAPPED] === true;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * Wraps a regular handler (arity <= 3). Rejections are forwarded to `next`
 * instead of escaping as unhandled rejections.
 */
function wrapHandler<T extends AnyHandler>(fn: T): T {
  const wrapped = function (this: unknown, req: unknown, res: unknown, next: NextFn) {
    let out: unknown;
    try {
      out = fn.call(this, req, res, next);
    } catch (err) {
      next(err);
      return;
    }
    if (isThenable(out)) {
      out.then(undefined, (err: unknown) => next(err));
    }
  };

  Object.defineProperty(wrapped, WRAPPED, { value: true });
  // Arity of the runtime function is 3, which is what Express inspects; the
  // declared type stays the caller's so inference in route files is unchanged.
  return wrapped as unknown as T;
}

/**
 * Wraps 4-arity middleware (Express's `(err, req, res, next)` signature).
 *
 * The runtime arity must be preserved exactly: Express decides whether a layer
 * is error middleware purely from `fn.length === 4`. A single wrapper that
 * always declared three parameters would cause every error handler in the app
 * to be treated as ordinary middleware and silently never run on errors.
 */
function wrapErrorHandler<T extends AnyHandler>(fn: T): T {
  const wrapped = function (
    this: unknown,
    err: unknown,
    req: unknown,
    res: unknown,
    next: NextFn,
  ) {
    let out: unknown;
    try {
      out = fn.call(this, err, req, res, next);
    } catch (thrown) {
      next(thrown);
      return;
    }
    if (isThenable(out)) {
      out.then(undefined, (nextErr: unknown) => next(nextErr));
    }
  };

  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped as unknown as T;
}

/**
 * Wraps one handler, preserving whether it is error middleware. Already-wrapped
 * handlers are returned untouched, so re-registering the same function (or
 * mounting a wrapped router twice) is safe.
 */
export function wrapAsyncHandler<T extends AnyHandler>(fn: T): T {
  if (typeof fn !== 'function' || isWrapped(fn)) return fn;
  return fn.length >= 4 ? wrapErrorHandler(fn) : wrapHandler(fn);
}

/** Convenience alias for a single handler, e.g. for `app.get(path, h)`. */
export const asyncHandler = wrapAsyncHandler;

/** Registration methods whose function arguments are request handlers. */
const ROUTER_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'all',
  'use',
  'param',
] as const;

/**
 * Reports whether a value was produced by {@link makeAsyncSafe} (or is an app
 * that has had it applied). Lets a test assert the invariant across every
 * router in a service, so a newly added route file that reaches for plain
 * `express.Router()` is caught rather than silently reintroducing the hang.
 */
export function isAsyncSafe(target: unknown): boolean {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) return false;
  const holder = target as Record<string, unknown>;
  return ROUTER_METHODS.some(
    method => typeof holder[method] === 'function'
      && (holder[method] as unknown as Record<symbol, unknown>)[PATCHED] === true,
  );
}

/**
 * Patches an Express application or router in place so that every handler
 * registered on it from then on is wrapped by {@link wrapAsyncHandler}.
 *
 * Apply this to the app itself as well as to routers — app-level `use`/`get`
 * handlers are just as capable of rejecting as route handlers. Call it before
 * registering any handler, since it only affects later registrations.
 */
export function makeAsyncSafe<T>(target: T): T {
  const holder = target as unknown as Record<string, AnyHandler>;

  for (const method of ROUTER_METHODS) {
    const original = holder[method];
    if (typeof original !== 'function') continue;
    // Already patched (e.g. a router created via Router()); skip so wrappers
    // do not stack.
    if ((original as unknown as Record<symbol, unknown>)[PATCHED] === true) continue;

    const patched = function (this: unknown, ...args: unknown[]) {
      // Only functions are handlers; path strings and options pass through.
      return original.apply(
        this,
        args.map(arg => (typeof arg === 'function' ? wrapAsyncHandler(arg as AnyHandler) : arg)),
      );
    } as AnyHandler;
    Object.defineProperty(patched, PATCHED, { value: true });

    holder[method] = patched;
  }

  return target;
}

/**
 * Drop-in replacement for `express.Router()`. Every function passed to
 * `router.get/post/put/patch/delete/all/use/param` is wrapped by
 * {@link wrapAsyncHandler}, so async handlers can throw/reject safely.
 *
 * Note this does not cover handlers registered via `router.route(...)`; none
 * are used in this codebase, and that form would need wrapping at the `Route`
 * level instead.
 */
export function Router(): ExpressRouterType {
  return makeAsyncSafe(express.Router());
}
