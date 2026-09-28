import { createServer, type Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { __resetShutdownForTests, installGracefulShutdown, isDraining } from './graceful-shutdown.js';

/**
 * The gateway had no signal handler at all, so on Kubernetes every rolling
 * deploy, node drain, HPA scale-in and node termination killed it outright:
 * in-flight requests got no response, admission permits stayed held in Redis
 * until their TTL, and the outbox relay stopped mid-publish.
 *
 * These drive the real signal path rather than calling the handler, because the
 * behaviour under test is what the process does when the platform signals it.
 */

function listen(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function freshServer(): Server {
  return createServer((_req, res) => res.end('ok'));
}

describe('graceful shutdown', () => {
  it('drains and exits 0 on SIGTERM', async () => {
    __resetShutdownForTests();
    const server = freshServer();
    const port = await listen(server);

    const exit = vi.fn();
    installGracefulShutdown(server, {
      drainDelayMs: 10,
      requestTimeoutMs: 200,
      workerTimeoutMs: 50,
      poolTimeoutMs: 50,
      exit,
      log: () => undefined,
    });

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 3000 });
    expect(port).toBeGreaterThan(0);
  });

  it('reports readiness as failing while draining', async () => {
    __resetShutdownForTests();
    expect(isDraining()).toBe(false);

    const server = freshServer();
    await listen(server);
    installGracefulShutdown(server, {
      drainDelayMs: 1,
      requestTimeoutMs: 100,
      workerTimeoutMs: 10,
      poolTimeoutMs: 10,
      exit: () => undefined,
      log: () => undefined,
    });

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(isDraining()).toBe(true), { timeout: 2000 });
  });

  it('stops background workers before closing resources', async () => {
    __resetShutdownForTests();
    const order: string[] = [];

    const server = freshServer();
    await listen(server);
    installGracefulShutdown(server, {
      drainDelayMs: 1,
      requestTimeoutMs: 100,
      workerTimeoutMs: 100,
      poolTimeoutMs: 100,
      onReadinessFail: () => void order.push('readiness'),
      stopWorkers: [() => void order.push('worker-1'), () => void order.push('worker-2')],
      closeResources: async () => void order.push('resources'),
      exit: () => undefined,
      log: () => undefined,
    });

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(order).toContain('resources'), { timeout: 3000 });

    // Ordering is the point: a worker that keeps running after the pools close
    // picks up work it cannot finish, and readiness must fail before the listener
    // stops so the load balancer can react while requests can still be served.
    expect(order).toEqual(['readiness', 'worker-1', 'worker-2', 'resources']);
  });

  /**
   * A shutdown that can hang is worse than one that gives up: the platform
   * SIGKILLs after the grace period, so the drain is wasted either way — but a
   * hung process also holds its port and its database connections.
   */
  it('gives up on a worker that never finishes and still exits', async () => {
    __resetShutdownForTests();
    const server = freshServer();
    await listen(server);

    const exit = vi.fn();
    const logs: string[] = [];
    installGracefulShutdown(server, {
      drainDelayMs: 1,
      requestTimeoutMs: 100,
      workerTimeoutMs: 40,
      poolTimeoutMs: 40,
      stopWorkers: [() => new Promise<void>(() => undefined)],
      exit,
      log: m => logs.push(m),
    });

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 3000 });
    expect(logs.some(l => l.includes('exceeded'))).toBe(true);
  });

  it('treats a second signal as a request to stop immediately', async () => {
    __resetShutdownForTests();
    const server = freshServer();
    await listen(server);

    const exit = vi.fn();
    installGracefulShutdown(server, {
      // Long enough that the second signal certainly arrives mid-drain.
      drainDelayMs: 500,
      requestTimeoutMs: 5000,
      workerTimeoutMs: 1000,
      poolTimeoutMs: 1000,
      exit,
      log: () => undefined,
    });

    process.emit('SIGTERM');
    await new Promise(r => setTimeout(r, 20));
    process.emit('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 2000 });
  });

  it('is idempotent, so two callers do not drain twice', async () => {
    __resetShutdownForTests();
    const server = freshServer();
    await listen(server);

    const exit = vi.fn();
    installGracefulShutdown(server, { exit, log: () => undefined, drainDelayMs: 1 });
    installGracefulShutdown(server, { exit, log: () => undefined, drainDelayMs: 1 });

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});
