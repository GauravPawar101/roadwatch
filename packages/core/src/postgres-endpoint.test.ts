import { describe, expect, it } from 'vitest';
import { createAdapterPool } from './postgres-adapter';
import { createPool } from './postgres';
import { normaliseSslMode } from './ssl-mode';

/**
 * These assert the property the whole configuration design rests on: a managed
 * endpoint is dialled even when the in-cluster one is also present.
 *
 * The previous implementations read `process.env.DATABASE_URL` directly, so
 * these tests would have resolved to the in-cluster host and passed a
 * connectivity check while silently ignoring the managed choice.
 */

const IN_CLUSTER = 'postgresql://postgres:postgres@postgres.roadwatch.svc.cluster.local:5432/roadwatch';
const MANAGED = 'postgresql://u:p@db.abc123.us-east-1.aws.rds.amazonaws.com:5432/roadwatch?sslmode=require';

/**
 * What the pool holds is the managed URL with its mode rewritten, not the URL as
 * written. Since pg-connection-string 2.7 `sslmode=require` is an alias for
 * `verify-full`, and a provider's private CA is not in the system trust store,
 * so the documented URL cannot be used verbatim. The rewrite is deliberate and
 * covered on its own in ssl-mode.test.ts; these tests pin the precedence, and
 * state the expectation in terms of the same function rather than repeating the
 * transformation by hand.
 */
const MANAGED_AS_DIALLED = normaliseSslMode(MANAGED, true);

describe('createPool endpoint precedence', () => {
  it('prefers the managed endpoint over the in-cluster one', () => {
    const pool = createPool({
      DATABASE_URL: IN_CLUSTER,
      DATABASE_CLOUD_URL: MANAGED,
    } as NodeJS.ProcessEnv);

    expect(pool.options.connectionString).toBe(MANAGED_AS_DIALLED);
    pool.end();
  });

  it('falls back to DATABASE_URL when no managed endpoint is set', () => {
    const pool = createPool({ DATABASE_URL: IN_CLUSTER } as NodeJS.ProcessEnv);
    expect(pool.options.connectionString).toBe(IN_CLUSTER);
    pool.end();
  });

  it('enables TLS for a managed endpoint that requires it', () => {
    const pool = createPool({ DATABASE_CLOUD_URL: MANAGED } as NodeJS.ProcessEnv);
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: false });
    pool.end();
  });

  it('does not enable TLS for a plaintext in-cluster endpoint', () => {
    const pool = createPool({ DATABASE_URL: IN_CLUSTER } as NodeJS.ProcessEnv);
    expect(pool.options.ssl).toBeUndefined();
    pool.end();
  });

  it('uses a predictable local target when nothing is configured', () => {
    const pool = createPool({} as NodeJS.ProcessEnv);
    expect(pool.options.connectionString).toBe('postgres://localhost:6432/roadwatch');
    pool.end();
  });
});

describe('createAdapterPool endpoint precedence', () => {
  it('prefers the managed endpoint over the in-cluster one', () => {
    const pool = createAdapterPool({
      DATABASE_URL: IN_CLUSTER,
      POSTGRES_CLOUD_URL: MANAGED,
    } as NodeJS.ProcessEnv);

    expect(pool.options.connectionString).toBe(MANAGED_AS_DIALLED);
    pool.end();
  });

  it('honours POSTGRES_CLOUD_URL as an alias', () => {
    const pool = createAdapterPool({ POSTGRES_CLOUD_URL: MANAGED } as NodeJS.ProcessEnv);
    expect(pool.options.connectionString).toBe(MANAGED_AS_DIALLED);
    pool.end();
  });

  it('falls back to DATABASE_URL when no managed endpoint is set', () => {
    const pool = createAdapterPool({ DATABASE_URL: IN_CLUSTER } as NodeJS.ProcessEnv);
    expect(pool.options.connectionString).toBe(IN_CLUSTER);
    pool.end();
  });

  it('builds a URL from discrete parts when no URL form is set', () => {
    const pool = createAdapterPool({
      POSTGRES_HOST: 'db.internal',
      POSTGRES_PORT: '6543',
      POSTGRES_DB: 'roadwatch',
      POSTGRES_USER: 'svc',
      POSTGRES_PASSWORD: 'p@ss word',
    } as NodeJS.ProcessEnv);

    // The password contains characters that must be percent-encoded or the URL
    // parses back with the wrong credentials.
    expect(pool.options.connectionString).toBe(
      'postgresql://svc:p%40ss%20word@db.internal:6543/roadwatch',
    );
    pool.end();
  });
});
