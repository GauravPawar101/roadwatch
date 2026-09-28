/**
 * Graceful shutdown for the gateway.
 *
 * The gateway installed no signal handler at all. On Kubernetes that is a
 * correctness problem, not a nicety: `kubectl apply`, a node drain, an HPA
 * scale-in and a node termination all send SIGTERM and then SIGKILL after a grace
 * period. A process with no handler dies on the first signal, so:
 *
 *  * requests already being served get no response — the client sees a reset
 *    connection rather than a completed request, and a write that committed in
 *    Postgres is reported to the caller as failed;
 *  * in-flight complaint writes hold admission permits, which are then released
 *    by a `finish` handler that never fires, so Redis inflight counts stay
 *    inflated until their TTL expires and real capacity is throttled away;
 *  * the Kafka outbox relay, the notification dispatcher and the retention jobs
 *    stop mid-flight, leaving rows claimed but not published.
 *
 * The shutdown sequence here is ordered so that each step is complete before the
 * next depends on it:
 *
 *  1. fail readiness, so the load balancer stops sending new requests while this
 *     instance is still able to serve the ones it has;
 *  2. stop the background workers, so nothing new starts;
 *  3. close the server, which stops accepting connections and fires `close` when
 *     the last connection ends;
 *  4. wait for in-flight requests, bounded — a request that never finishes must
 *     not prevent the process from exiting, or the platform SIGKILLs it anyway
 *     and the drain was wasted;
 *  5. release permits and close pools, then exit.
 *
 * Every bound is configurable and every wait is a timeout, never an open-ended
 * promise: a shutdown that can hang is worse than one that gives up.
 */
import type { Server } from 'node:http';

export type ShutdownOptions = {
  /** ms to keep serving after readiness fails, for the load balancer to notice. */
  drainDelayMs?: number;
  /** ms to wait for in-flight requests before forcing the exit. */
  requestTimeoutMs?: number;
  /** ms to wait for background workers to stop. */
  workerTimeoutMs?: number;
  /** ms to wait for pools and clients to close. */
  poolTimeoutMs?: number;
  /** Called first, to fail readiness. Must not throw. */
  onReadinessFail?: () => void | Promise<void>;
  /** Background workers to stop, in order. Each is given the remaining budget. */
  stopWorkers?: Array<() => void | Promise<void>>;
  /** Called last, to release admission permits and close pools. */
  closeResources?: () => void | Promise<void>;
  /** Injected for tests; defaults to process.exit. */
  exit?: (code: number) => void;
  /** Injected for tests; defaults to the real clock. */
  log?: (message: string) => void;
};

const DEFAULTS = {
  drainDelayMs: 5_000,
  requestTimeoutMs: 25_000,
  workerTimeoutMs: 10_000,
  poolTimeoutMs: 10_000,
} as const;

/** Resolves after `ms`, or immediately when a negative/zero budget is given. */
function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms).unref?.() ?? resolve);
}

/**
 * Runs `work` with a deadline.
 *
 * A timeout here is normal and must not reject: the caller's job is to make
 * progress regardless, and an unhandled rejection during shutdown would replace a
 * clean exit with a stack trace and a non-zero code.
 */
async function withDeadline<T>(
  label: string,
  ms: number,
  work: () => Promise<T> | T,
  log: (message: string) => void,
): Promise<T | undefined> {
  if (ms <= 0) {
    log(`[shutdown] ${label}: no budget left, skipped`);
    return undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>(resolve => {
    timer = setTimeout(() => {
      log(`[shutdown] ${label}: exceeded ${ms}ms, continuing`);
      resolve(undefined);
    }, ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } catch (error) {
    log(`[shutdown] ${label}: failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let installed = false;

/**
 * Installs the handler. Idempotent, because both `index.ts` and a test harness
 * may reach for it and two handlers would drain twice.
 */
export function installGracefulShutdown(
  server: Server,
  options: ShutdownOptions = {},
): () => void {
  const log = options.log ?? (message => console.log(message));
  const exit = options.exit ?? (code => process.exit(code));

  if (installed) {
    log('[shutdown] already installed, ignoring');
    return () => undefined;
  }
  installed = true;

  let shuttingDown = false;

  const handler = async (signal: string): Promise<void> => {
    // A second signal means "stop waiting". Kubernetes sends SIGKILL itself
    // after the grace period, so a second SIGTERM is the operator asking for
    // this process gone now.
    if (shuttingDown) {
      log(`[shutdown] ${signal} again, exiting immediately`);
      exit(1);
      return;
    }
    shuttingDown = true;
    draining = true;
    const startedAt = Date.now();
    log(`[shutdown] ${signal} received, draining`);

    // 1. Stop receiving traffic while still able to answer what it has, then
    //    *wait* for the load balancer to notice.
    //
    //    The wait is the part that matters and is easy to omit. Failing readiness
    //    and immediately closing the listener leaves a window of a few
    //    milliseconds — measured at 6ms on this service — which is far shorter
    //    than any load balancer's polling interval, so the balancer keeps routing
    //    to an instance that has already stopped accepting and the client sees a
    //    connection error instead of a drained response. Kubernetes' own guidance
    //    is the same shape: a preStop sleep, or an equivalent pause here.
    const drainDelay = options.drainDelayMs ?? DEFAULTS.drainDelayMs;
    await withDeadline(
      'readiness',
      // The pause is the work here, so the deadline is the pause *plus* a margin.
      // Giving it exactly the pause means the two expire together and the log
      // claims the step was cut short when it completed normally.
      drainDelay + 500,
      async () => {
        await options.onReadinessFail?.();
        // Held open deliberately: this is the pause, not an oversight.
        await delay(drainDelay);
      },
      log,
    );

    // 2. Stop background work before closing the server, so a worker cannot pick
    //    up new work after the data stores it needs are closing.
    for (const [index, stop] of (options.stopWorkers ?? []).entries()) {
      await withDeadline(`worker ${index + 1}`, options.workerTimeoutMs ?? DEFAULTS.workerTimeoutMs, stop, log);
    }

    // 3. Close the listener. This resolves when the last connection ends, so it
    //    doubles as the in-flight wait.
    await withDeadline(
      'server close',
      options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
      () =>
        new Promise<void>(resolve => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
          // Node 18.2+: tells keep-alive connections to close once idle rather
          // than holding the server open until the client times out. Without it
          // the drain waits out every keep-alive timeout, which is the single
          // most common reason a graceful shutdown appears to hang.
          server.closeIdleConnections?.();
        }),
      log,
    );
    // Anything still connected after the budget: destroy rather than wait.
    server.closeAllConnections?.();

    // 4. Release permits and close pools.
    await withDeadline('resources', options.poolTimeoutMs ?? DEFAULTS.poolTimeoutMs, async () => {
      await options.closeResources?.();
    }, log);

    log(`[shutdown] drained in ${Date.now() - startedAt}ms`);
    exit(0);
  };

  const onTerm = (): void => void handler('SIGTERM');
  const onInt = (): void => void handler('SIGINT');

  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);

  return () => {
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
    installed = false;
  };
}

/** Test hook: allows a fresh install in the same process. */
export function __resetShutdownForTests(): void {
  installed = false;
  draining = false;
}

/**
 * True once a signal has been handled and the drain has begun.
 *
 * The readiness endpoint reports 503 while this is set. That is the only way a
 * load balancer learns to stop sending new requests: closing the listener stops
 * *new connections*, but a keep-alive connection the balancer already holds stays
 * usable and would keep being written to for the whole drain.
 */
let draining = false;

export function isDraining(): boolean {
  return draining;
}
