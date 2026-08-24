export type CircuitState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerOptions = {
  failureThreshold?: number;
  openMs?: number;
  name?: string;
};

/**
 * Lightweight circuit breaker for Fabric / upstream hops.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openMs = options.openMs ?? 30_000;
    this.name = options.name ?? 'circuit';
  }

  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  private maybeHalfOpen(): void {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.openMs) {
      this.state = 'half_open';
    }
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();
    if (this.state === 'open') {
      const error = new Error(`${this.name} circuit open`);
      (error as any).statusCode = 503;
      (error as any).retryAfterSeconds = Math.max(1, Math.ceil((this.openMs - (Date.now() - this.openedAt)) / 1000));
      throw error;
    }

    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.failureThreshold || this.state === 'half_open') {
        this.state = 'open';
        this.openedAt = Date.now();
      }
      throw error;
    }
  }
}
