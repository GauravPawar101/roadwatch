import { describe, expect, it } from 'vitest';
import {
  assertManagedEndpoints,
  describeManagedEndpointGaps,
  formatManagedEndpointGaps
} from './endpoints.js';

/**
 * The precedence chain falls back to the in-cluster or local default whenever
 * the managed tier is absent. That is what lets a device run with no cloud
 * account — and it is also what makes a typo in REDIS_CLOUD_URL, or a Secret
 * that failed to mount, indistinguishable from a deliberate local run.
 *
 * These pin the distinction: nothing configured is normal, something
 * configured but unresolved is a mistake worth shouting about.
 */

const CLOUD_ALL = {
  DATABASE_CLOUD_URL: 'postgresql://u:p@db.example.com:5432/roadwatch?sslmode=require',
  REDIS_CLOUD_URL: 'rediss://default:t@upstash.io:6379',
  KAFKA_EVENTS_CLOUD_BROKERS: 'a.confluent.cloud:9094',
  KAFKA_HLF_CLOUD_BROKERS: 'b.redpanda.com:9094',
} as NodeJS.ProcessEnv;

const LOCAL_ALL = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:16432/roadwatch',
  REDIS_URL: 'redis://127.0.0.1:16379/0',
  KAFKA_EVENTS_BROKERS: '127.0.0.1:9095',
  KAFKA_HLF_BROKERS: '127.0.0.1:9094',
} as NodeJS.ProcessEnv;

describe('describeManagedEndpointGaps', () => {
  it('reports nothing when every component resolves to the managed tier', () => {
    expect(describeManagedEndpointGaps(CLOUD_ALL)).toEqual([]);
    expect(formatManagedEndpointGaps([])).toBe('all managed endpoints configured');
  });

  it('marks a fully local deployment as a normal on-device fallback, not a fault', () => {
    const gaps = describeManagedEndpointGaps(LOCAL_ALL);

    expect(gaps.map(g => g.component).sort()).toEqual([
      'kafka.events', 'kafka.hlf', 'postgres', 'redis'
    ]);
    expect(gaps.every(g => g.problem === undefined)).toBe(true);
    expect(formatManagedEndpointGaps(gaps)).toContain('on-device fallback');
    expect(formatManagedEndpointGaps(gaps)).not.toContain('MISCONFIGURED');
  });

  /**
   * The mistakes that actually occur. A managed variable that is merely *set*
   * can never fail to resolve — any non-empty value becomes the URL — so the
   * useful checks are on the value's shape.
   */
  it('flags a managed Postgres URL with no sslmode, which providers refuse', () => {
    const gaps = describeManagedEndpointGaps({
      DATABASE_CLOUD_URL: 'postgresql://u:p@db.example.com:5432/roadwatch',
    } as NodeJS.ProcessEnv);

    const pg = gaps.find(g => g.component === 'postgres');
    expect(pg?.problem).toMatch(/sslmode=require/);
    expect(formatManagedEndpointGaps(gaps)).toContain('MANAGED ENDPOINT PROBLEM');
  });

  it('flags a Redis URL that is not TLS, which Upstash requires', () => {
    const gaps = describeManagedEndpointGaps({
      REDIS_CLOUD_URL: 'redis://default:t@upstash.io:6379',
    } as NodeJS.ProcessEnv);

    expect(gaps.find(g => g.component === 'redis')?.problem).toMatch(/rediss/);
  });

  it('flags an unreplaced localhost placeholder', () => {
    const gaps = describeManagedEndpointGaps({
      DATABASE_CLOUD_URL: 'postgresql://u:p@localhost:5432/roadwatch?sslmode=require',
    } as NodeJS.ProcessEnv);

    expect(gaps.find(g => g.component === 'postgres')?.problem).toMatch(/localhost/);
  });

  it('flags managed brokers on the plaintext port', () => {
    const gaps = describeManagedEndpointGaps({
      KAFKA_EVENTS_CLOUD_BROKERS: 'broker.example.com:9092',
    } as NodeJS.ProcessEnv);

    expect(gaps.find(g => g.component === 'kafka.events')?.problem).toMatch(/9094/);
  });

  it('flags a broker with no port', () => {
    const gaps = describeManagedEndpointGaps({
      KAFKA_EVENTS_CLOUD_BROKERS: 'pkc-abc.confluent.cloud',
    } as NodeJS.ProcessEnv);

    expect(gaps.find(g => g.component === 'kafka.events')?.problem).toMatch(/no port/);
  });

  it('flags a value that is not parseable as a URL', () => {
    const gaps = describeManagedEndpointGaps({
      REDIS_CLOUD_URL: 'not a url at all',
    } as NodeJS.ProcessEnv);

    expect(gaps.find(g => g.component === 'redis')?.problem).toMatch(/not a valid URL/);
  });

  it('flags a host:port value pasted without its scheme', () => {
    // `new URL` accepts this and reads "upstash.io:" as the protocol, so the
    // diagnosis is a scheme mismatch rather than a parse failure — which is the
    // more useful message.
    const gaps = describeManagedEndpointGaps({
      REDIS_CLOUD_URL: 'upstash.io:6379',
    } as NodeJS.ProcessEnv);

    expect(gaps.find(g => g.component === 'redis')?.problem).toMatch(/not a Redis scheme/);
  });

  it('does not flag a correct managed configuration', () => {
    expect(
      describeManagedEndpointGaps(CLOUD_ALL).filter(g => g.problem),
    ).toEqual([]);
  });

  it('names the variables that would enable each component', () => {
    const message = formatManagedEndpointGaps(describeManagedEndpointGaps({}));
    expect(message).toContain('DATABASE_CLOUD_URL');
    expect(message).toContain('REDIS_CLOUD_URL');
    expect(message).toContain('KAFKA_EVENTS_CLOUD_BROKERS');
    expect(message).toContain('KAFKA_HLF_CLOUD_BROKERS');
  });

  it('reports per component, so a split provider setup is visible', () => {
    // Events on a managed cluster, HLF still in-cluster.
    const gaps = describeManagedEndpointGaps({
      ...LOCAL_ALL,
      KAFKA_EVENTS_CLOUD_BROKERS: 'a.confluent.cloud:9094',
    } as NodeJS.ProcessEnv);

    expect(gaps.find(g => g.component === 'kafka.events')).toBeUndefined();
    expect(gaps.find(g => g.component === 'kafka.hlf')).toBeDefined();
  });

  it('contains no secret values, only variable names', () => {
    const message = formatManagedEndpointGaps(describeManagedEndpointGaps({}));
    expect(message).not.toMatch(/:\/\/[^ ]*@/);
    expect(message).not.toMatch(/rediss:\/\/|postgres:\/\//);
  });
});

describe('assertManagedEndpoints', () => {
  it('is a no-op unless INFRA_REQUIRE_MANAGED is set', () => {
    expect(() => assertManagedEndpoints(LOCAL_ALL)).not.toThrow();
    expect(() => assertManagedEndpoints(CLOUD_ALL)).not.toThrow();
  });

  it('still allows a fully local deployment in strict mode', () => {
    // Strict mode exists to catch a broken Secret, not to force cloud usage.
    expect(() =>
      assertManagedEndpoints({ ...LOCAL_ALL, INFRA_REQUIRE_MANAGED: 'true' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('refuses to start when a managed endpoint is configured wrongly', () => {
    const env = {
      ...LOCAL_ALL,
      INFRA_REQUIRE_MANAGED: 'true',
      DATABASE_CLOUD_URL: 'postgresql://u:p@db.example.com:5432/roadwatch',
    } as NodeJS.ProcessEnv;

    expect(() => assertManagedEndpoints(env)).toThrow(/INFRA_REQUIRE_MANAGED/);
    expect(() => assertManagedEndpoints(env)).toThrow(/sslmode/);
  });

  it('accepts a fully managed deployment in strict mode', () => {
    expect(() =>
      assertManagedEndpoints({ ...CLOUD_ALL, INFRA_REQUIRE_MANAGED: '1' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
