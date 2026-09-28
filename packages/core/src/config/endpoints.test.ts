import { describe, expect, it } from 'vitest';
import {
  describeEndpoints,
  resolveKafkaEndpoint,
  resolvePostgresEndpoint,
  resolveRedisEndpoint,
  type Env,
} from '../config/endpoints';

const IN_CLUSTER_REDIS = { REDIS_HOST: 'redis-0.redis.roadwatch.svc.cluster.local', REDIS_PORT: '6379' };

describe('resolvePostgresEndpoint', () => {
  it('prefers a managed cloud URL over the generic DATABASE_URL', () => {
    // k8s always materialises DATABASE_URL from the infra ConfigMap, so the
    // cloud variable has to be consulted first to ever take effect.
    const env: Env = {
      DATABASE_URL: 'postgresql://u:p@postgres-primary-0.postgres.svc.cluster.local:5432/db',
      DATABASE_CLOUD_URL: 'postgresql://u:p@rds.example.com:5432/db',
    };
    const r = resolvePostgresEndpoint(env);
    expect(r.connectionString).toBe('postgresql://u:p@rds.example.com:5432/db');
    expect(r.source).toBe('cloud');
  });

  it('uses DATABASE_URL when no cloud URL is configured', () => {
    const r = resolvePostgresEndpoint({ DATABASE_URL: 'postgresql://u:p@explicit.example.com:5432/db' });
    expect(r.connectionString).toBe('postgresql://u:p@explicit.example.com:5432/db');
    expect(r.source).toBe('explicit');
  });

  it('assembles a connection string from parts for in-cluster/local postgres', () => {
    const r = resolvePostgresEndpoint({
      POSTGRES_HOST: 'postgres-primary-0.postgres.roadwatch.svc.cluster.local',
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'roadwatch',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgres',
    });
    expect(r.connectionString).toBe(
      'postgresql://postgres:postgres@postgres-primary-0.postgres.roadwatch.svc.cluster.local:5432/roadwatch',
    );
    expect(r.source).toBe('in-cluster');
  });

  it('percent-encodes credentials containing URL metacharacters', () => {
    const r = resolvePostgresEndpoint({
      POSTGRES_HOST: 'db.example.com',
      POSTGRES_DB: 'roadwatch',
      POSTGRES_USER: 'road@watch',
      POSTGRES_PASSWORD: 'p@ss/w:rd',
    });
    expect(r.connectionString).toContain('road%40watch');
    expect(r.connectionString).toContain('p%40ss%2Fw%3Ard');
  });

  it('honours libpq-style PG* variables', () => {
    const r = resolvePostgresEndpoint({ PGHOST: 'pg.example.com', PGDATABASE: 'roadwatch', PGUSER: 'app' });
    expect(r.connectionString).toBe('postgresql://app@pg.example.com:5432/roadwatch');
  });

  it('adds sslmode=require when POSTGRES_SSL is set', () => {
    const r = resolvePostgresEndpoint({
      POSTGRES_HOST: 'rds.example.com',
      POSTGRES_DB: 'roadwatch',
      POSTGRES_USER: 'app',
      POSTGRES_SSL: 'true',
    });
    expect(r.connectionString).toContain('?sslmode=require');
    expect(r.ssl).toBe(true);
  });

  it('detects TLS from an explicit URL', () => {
    expect(resolvePostgresEndpoint({ DATABASE_URL: 'postgresql://u:p@h:5432/db?sslmode=require' }).ssl).toBe(true);
    expect(resolvePostgresEndpoint({ DATABASE_URL: 'postgresql://u:p@h:5432/db' }).ssl).toBe(false);
  });

  it('ignores blank / whitespace-only values so the chain continues', () => {
    const r = resolvePostgresEndpoint({ DATABASE_URL: '   ', DATABASE_CLOUD_URL: 'postgresql://u:p@c:5432/db' });
    expect(r.source).toBe('cloud');
  });

  it('reports unset when nothing is configured', () => {
    const r = resolvePostgresEndpoint({});
    expect(r.source).toBe('unset');
    expect(r.connectionString).toBe('');
  });
});

describe('resolveRedisEndpoint', () => {
  it('prefers a managed cloud URL over REDIS_URL', () => {
    const r = resolveRedisEndpoint({
      REDIS_URL: 'redis://redis-0.redis.roadwatch.svc.cluster.local:6379/0',
      REDIS_CLOUD_URL: 'rediss://default.x.use1.cache.amazonaws.com:6379/0',
    });
    expect(r.source).toBe('cloud');
    // Managed offerings are TLS-only, so rediss:// must be detected.
    expect(r.tls).toBe(true);
  });

  it('uses REDIS_URL when no cloud URL is configured', () => {
    const r = resolveRedisEndpoint({ REDIS_URL: 'redis://cache.example.com:6379/3', ...IN_CLUSTER_REDIS });
    expect(r.url).toBe('redis://cache.example.com:6379/3');
    expect(r.source).toBe('explicit');
    expect(r.db).toBe(3);
  });

  it('accepts REDIS_URI as an alias', () => {
    const r = resolveRedisEndpoint({ REDIS_URI: 'redis://uri.example.com:6379/1' });
    expect(r.url).toBe('redis://uri.example.com:6379/1');
  });

  it('falls back to the managed cloud URL when no explicit URL is set', () => {
    const r = resolveRedisEndpoint({
      REDIS_CLOUD_URL: 'rediss://default.x.use1.cache.amazonaws.com:6379/0',
      ...IN_CLUSTER_REDIS,
    });
    expect(r.source).toBe('cloud');
    expect(r.tls).toBe(true);
  });

  it('builds an in-cluster URL from REDIS_HOST', () => {
    const r = resolveRedisEndpoint(IN_CLUSTER_REDIS);
    expect(r.url).toBe('redis://redis-0.redis.roadwatch.svc.cluster.local:6379/0');
    expect(r.source).toBe('in-cluster');
  });

  it('includes the password when provided', () => {
    const r = resolveRedisEndpoint({ REDIS_HOST: 'r.example.com', REDIS_PASSWORD: 'p@ss' });
    expect(r.url).toBe('redis://:p%40ss@r.example.com:6379/0');
  });

  it('uses rediss:// when REDIS_TLS is set', () => {
    const r = resolveRedisEndpoint({ REDIS_HOST: 'r.example.com', REDIS_TLS: 'true' });
    expect(r.url.startsWith('rediss://')).toBe(true);
    expect(r.tls).toBe(true);
  });

  it('honours REDIS_DB', () => {
    expect(resolveRedisEndpoint({ REDIS_HOST: 'h', REDIS_DB: '5' }).url.endsWith('/5')).toBe(true);
  });

  it('reports unset with no configuration', () => {
    const r = resolveRedisEndpoint({});
    expect(r.source).toBe('unset');
    expect(r.url).toBe('');
  });
});

describe('resolveKafkaEndpoint', () => {
  it('prefers managed cloud brokers over the in-cluster list', () => {
    const r = resolveKafkaEndpoint('events', {
      KAFKA_EVENTS_BROKERS: 'kafka-events-0.kafka-events-headless.roadwatch.svc.cluster.local:29092',
      KAFKA_EVENTS_CLOUD_BROKERS: 'kafka-1.aws:9094,kafka-2.aws:9094',
    });
    expect(r.brokers).toEqual(['kafka-1.aws:9094', 'kafka-2.aws:9094']);
    expect(r.source).toBe('cloud');
  });

  it('uses the cluster-specific brokers when no cloud list is set', () => {
    const r = resolveKafkaEndpoint('events', {
      KAFKA_EVENTS_BROKERS: 'a:9092,b:9092',
      KAFKA_BROKERS: 'legacy:9092',
    });
    expect(r.brokers).toEqual(['a:9092', 'b:9092']);
    expect(r.source).toBe('explicit');
  });

  it('falls back to managed cloud brokers for the hlf cluster', () => {
    const r = resolveKafkaEndpoint('hlf', {
      KAFKA_HLF_CLOUD_BROKERS: 'kafka-1.aws:9094,kafka-2.aws:9094',
      KAFKA_HLF_BROKERS: 'internal:29092',
    });
    expect(r.brokers).toEqual(['kafka-1.aws:9094', 'kafka-2.aws:9094']);
    expect(r.source).toBe('cloud');
  });

  it('accepts the singular _BROKER spelling', () => {
    expect(resolveKafkaEndpoint('events', { KAFKA_EVENTS_BROKER: 'solo:9092' }).brokers).toEqual(['solo:9092']);
  });

  it('uses the legacy shared alias for the events cluster', () => {
    const r = resolveKafkaEndpoint('events', { KAFKA_BROKERS: 'shared-1:9092,shared-2:9092' });
    expect(r.brokers).toEqual(['shared-1:9092', 'shared-2:9092']);
  });

  it('does NOT apply the legacy shared alias to the hlf cluster', () => {
    // The HLF cluster backs Fabric anchoring; silently inheriting the events
    // brokers would send anchor traffic to the wrong cluster.
    const r = resolveKafkaEndpoint('hlf', { KAFKA_BROKERS: 'shared-1:9092' });
    expect(r.brokers).toEqual([]);
    expect(r.source).toBe('unset');
  });

  it('splits and trims a broker list', () => {
    expect(resolveKafkaEndpoint('events', { KAFKA_EVENTS_BROKERS: ' a:1 , b:2 ,, ' }).brokers).toEqual([
      'a:1',
      'b:2',
    ]);
  });

  it('falls back to the supplied default', () => {
    const r = resolveKafkaEndpoint('events', {}, { brokers: 'localhost:9095' });
    expect(r.brokers).toEqual(['localhost:9095']);
    expect(r.source).toBe('local-default');
  });
});

describe('describeEndpoints', () => {
  it('reports the resolved source for each endpoint', () => {
    const summary = describeEndpoints({ REDIS_URL: 'redis://x:6379/0' });
    expect(summary).toContain('redis[explicit]');
    expect(summary).toContain('postgres[unset]');
  });

  it('redacts credentials', () => {
    const summary = describeEndpoints({ REDIS_URL: 'redis://user:hunter2@cache:6379/0' });
    expect(summary).not.toContain('hunter2');
  });
});
