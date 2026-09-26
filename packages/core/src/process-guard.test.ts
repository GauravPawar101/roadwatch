import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installProcessGuards } from './process-guard';

let uninstall: (() => void) | undefined;
let logged: Array<[string, unknown]>;
let exit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logged = [];
  exit = vi.fn();
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

function install(maxLoggedRejections = 100) {
  uninstall = installProcessGuards({
    serviceName: 'test-svc',
    maxLoggedRejections,
    log: (message, detail) => logged.push([message, detail]),
    exit,
  });
}

/**
 * Node's types only model `process.emit` for POSIX signals, but the runtime
 * accepts any event name. Go through a loosely-typed view of the emitter.
 */
function emit(event: 'unhandledRejection' | 'uncaughtException', payload: unknown) {
  (process as unknown as { emit: (e: string, p?: unknown) => boolean }).emit(event, payload);
}

describe('installProcessGuards', () => {
  it('logs an unhandled rejection and keeps the process alive', () => {
    install();
    emit('unhandledRejection', new Error('db constraint violation'));

    expect(logged).toHaveLength(1);
    expect(logged[0]![0]).toContain('unhandled promise rejection (1/100)');
    expect(exit).not.toHaveBeenCalled();
  });

  it('does not exit on a small number of rejections', () => {
    install(5);
    for (let i = 0; i < 4; i += 1) emit('unhandledRejection', new Error(`boom ${i}`));
    expect(exit).not.toHaveBeenCalled();
    expect(logged).toHaveLength(4);
  });

  /**
   * A handler that leaks a rejection per request would otherwise spin forever
   * writing logs; after the threshold the process must exit so the orchestrator
   * can restart it clean.
   */
  it('exits once the rejection threshold is reached', () => {
    install(3);
    for (let i = 0; i < 3; i += 1) emit('unhandledRejection', new Error(`boom ${i}`));

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logged.at(-1)![0]).toContain('too many unhandled rejections');
  });

  it('exits immediately on an uncaught exception, since state is undefined', () => {
    install();
    emit('uncaughtException', new Error('segfault-ish'));

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logged[0]![0]).toContain('uncaught exception, shutting down');
  });

  it('removes its listeners on cleanup', () => {
    install();
    uninstall?.();
    uninstall = undefined;

    // With the guard's listener gone, an emitted rejection has no handler and
    // Node reports it as a real unhandled rejection. Absorb it here so the
    // assertion is about our cleanup, not about Node's default behaviour.
    const absorb = () => {};
    process.on('unhandledRejection', absorb);
    try {
      emit('unhandledRejection', new Error('after cleanup'));
    } finally {
      process.off('unhandledRejection', absorb);
    }

    expect(logged).toHaveLength(0);
    expect(exit).not.toHaveBeenCalled();
  });

  it('is safe to call twice and does not double-log', () => {
    install();
    const second = installProcessGuards({
      serviceName: 'test-svc',
      log: (message, detail) => logged.push([message, detail]),
      exit,
    });

    emit('unhandledRejection', new Error('once'));
    expect(logged).toHaveLength(1);

    second();
  });
});
