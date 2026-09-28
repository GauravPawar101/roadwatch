/**
 * Process-level error guards for the long-running services.
 *
 * Without these, a single request whose handler rejects outside its own
 * try/catch becomes an unhandled rejection and Node terminates the process.
 * That is not theoretical: a JWT whose `sub` was not a UUID reached Postgres,
 * aborted the surrounding transaction, and took the whole gateway down.
 *
 * `unhandledRejection` is logged and the process keeps serving, because one
 * failed request does not corrupt process state. `uncaughtException` still
 * exits — at that point the state is undefined and continuing is unsafe.
 *
 * A service whose handler leaks a rejection on every request would otherwise
 * spin forever writing logs, so after `maxLoggedRejections` the process exits
 * and lets the orchestrator restart it clean.
 */

export type ProcessGuardOptions = {
  serviceName: string;
  /** Exit after this many unhandled rejections. Default 100. */
  maxLoggedRejections?: number;
  /** Sink for diagnostics. Defaults to console.error. */
  log?: (message: string, detail?: unknown) => void;
  /** Exit function, injectable for tests. Defaults to process.exit. */
  exit?: (code: number) => void;
};

const DEFAULT_MAX_LOGGED_REJECTIONS = 100;

/**
 * Module-level, so a second call to installProcessGuards (module imported
 * twice, or a service plus a test harness) cannot register duplicate handlers
 * and double-log every rejection.
 */
let activeInstall: (() => void) | null = null;

export function installProcessGuards(options: ProcessGuardOptions): () => void {
  // Already installed: hand back a no-op disposer rather than double-register.
  if (activeInstall) return () => {};

  const {
    serviceName,
    maxLoggedRejections = DEFAULT_MAX_LOGGED_REJECTIONS,
    log = (message, detail) => {
      if (detail === undefined) console.error(message);
      else console.error(message, detail);
    },
    exit = (code: number) => process.exit(code),
  } = options;

  let rejections = 0;

  const onUnhandledRejection = (reason: unknown) => {
    rejections += 1;
    log(
      `[${serviceName}] unhandled promise rejection (${rejections}/${maxLoggedRejections}):`,
      reason,
    );
    if (rejections >= maxLoggedRejections) {
      log(
        `[${serviceName}] too many unhandled rejections — exiting so the orchestrator can restart cleanly.`,
      );
      exit(1);
    }
  };

  const onUncaughtException = (err: unknown) => {
    log(`[${serviceName}] uncaught exception, shutting down:`, err);
    exit(1);
  };

  if (typeof process.on !== 'function') {
    return () => {};
  }

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  const dispose = () => {
    process.off('unhandledRejection', onUnhandledRejection);
    process.off('uncaughtException', onUncaughtException);
    if (activeInstall === dispose) activeInstall = null;
  };

  activeInstall = dispose;
  return dispose;
}
