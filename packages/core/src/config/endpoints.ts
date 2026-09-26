/**
 * Shared infrastructure endpoint resolution.
 *
 * Every service (gateway-api, backend-api, scheduler, webhook-handler,
 * fabric-anchor-consumer, media-ingest) needs the same four endpoints. This
 * module defines ONE precedence contract so a service never silently talks to
 * localhost in a cluster, or to an in-cluster host when a managed cloud
 * endpoint was configured.
 *
 * Precedence is always: managed/cloud -> explicit URL -> in-cluster or local
 * parts -> built-in default. The first non-empty value wins, and
 * `describeEndpoints` reports which source was used so misconfiguration is
 * visible in logs instead of mysterious.
 *
 * Cloud variables are consulted FIRST on purpose. In Kubernetes the deployments
 * always materialise DATABASE_URL / REDIS_URL / KAFKA_*_BROKERS from the
 * generic infra ConfigMap, so an "explicit" tier would always be satisfied and a
 * managed endpoint could never take effect. A *_CLOUD_* variable is a
 * deliberate deployment-target choice, so it outranks the generic name.
 *
 * Deliberately dependency-free (no react-native, no dotenv) so it is safe to
 * import from server services and from the mobile app.
 */

export type Env = Record<string, string | undefined>;

export type EndpointSource =
  | 'explicit'
  | 'cloud'
  | 'in-cluster'
  | 'local-default'
  | 'unset';

export type ResolvedEndpoint<T = string> = {
  /** Resolved value, or undefined when nothing was configured. */
  value: T | undefined;
  /** Which tier of the fallback chain supplied the value. */
  source: EndpointSource;
  /** Env var names consulted, in precedence order (for diagnostics). */
  consulted: string[];
};

function clean(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Walk a precedence chain and report the first usable value. */
function resolveChain(
  env: Env,
  tiers: Array<{ source: EndpointSource; keys: string[] }>,
): ResolvedEndpoint {
  const consulted = tiers.flatMap((t) => t.keys);
  for (const tier of tiers) {
    for (const key of tier.keys) {
      const value = clean(env[key]);
      if (value !== undefined) {
        return { value, source: tier.source, consulted };
      }
    }
  }
  return { value: undefined, source: 'unset', consulted };
}

// ── Postgres ────────────────────────────────────────────────────────────────

export type PostgresEndpoint = {
  connectionString: string;
  source: EndpointSource;
  ssl: boolean;
};

function encodeUserInfo(value: string): string {
  // Credentials in a URL must be percent-encoded (passwords contain @ and /).
  return encodeURIComponent(value);
}

export function resolvePostgresEndpoint(
  env: Env = process.env,
  defaults: { host?: string; port?: string; db?: string; user?: string; password?: string } = {},
): PostgresEndpoint {
  const chain = resolveChain(env, [
    { source: 'cloud', keys: ['DATABASE_CLOUD_URL', 'POSTGRES_CLOUD_URL'] },
    { source: 'explicit', keys: ['DATABASE_URL'] },
  ]);

  if (chain.value) {
    return {
      connectionString: chain.value,
      source: chain.source,
      ssl: /sslmode=require|ssl=true/i.test(chain.value) || clean(env.DATABASE_SSL) === 'true',
    };
  }

  // Accept the libpq PG* spellings too: `pg` reads them natively, so a
  // deployment that sets PGHOST would otherwise be silently ignored here.
  const host = clean(env.POSTGRES_HOST) ?? clean(env.PGHOST) ?? clean(defaults.host);
  const port = clean(env.POSTGRES_PORT) ?? clean(env.PGPORT) ?? clean(defaults.port);
  const db = clean(env.POSTGRES_DB) ?? clean(env.PGDATABASE) ?? clean(defaults.db);
  const user = clean(env.POSTGRES_USER) ?? clean(env.PGUSER) ?? clean(defaults.user);
  const password = clean(env.POSTGRES_PASSWORD) ?? clean(env.PGPASSWORD) ?? clean(defaults.password);

  if (!host || !db) {
    return { connectionString: '', source: 'unset', ssl: false };
  }

  const auth = user ? `${encodeUserInfo(user)}${password ? `:${encodeUserInfo(password)}` : ''}@` : '';
  const ssl = clean(env.POSTGRES_SSL ?? env.DATABASE_SSL) === 'true' ? '?sslmode=require' : '';

  return {
    connectionString: `postgresql://${auth}${host}:${port ?? '5432'}/${db}${ssl}`,
    source: host.includes('.svc.') || host.includes('cluster.local') ? 'in-cluster' : 'local-default',
    ssl: Boolean(ssl),
  };
}

// ── Redis ───────────────────────────────────────────────────────────────────

export type RedisEndpoint = {
  url: string;
  source: EndpointSource;
  db: number;
  /** True when the endpoint is TLS (rediss://), typical for managed offerings. */
  tls: boolean;
};

export function resolveRedisEndpoint(
  env: Env = process.env,
  defaults: { host?: string; port?: string; db?: number } = {},
): RedisEndpoint {
  const chain = resolveChain(env, [
    { source: 'cloud', keys: ['REDIS_CLOUD_URL', 'REDIS_MANAGED_URL'] },
    { source: 'explicit', keys: ['REDIS_URL', 'REDIS_URI'] },
  ]);

  if (chain.value) {
    const tls = chain.value.startsWith('rediss://');
    // Database index from the URL path, defaulting to 0.
    const path = chain.value.replace(/^rediss?:\/\//, '').split('/')[1];
    const db = path !== undefined && /^\d+$/.test(path) ? Number(path) : (defaults.db ?? 0);
    return { url: chain.value, source: chain.source, db, tls };
  }

  const host = clean(env.REDIS_HOST) ?? clean(defaults.host);
  if (!host) {
    return { url: '', source: 'unset', db: defaults.db ?? 0, tls: false };
  }

  const port = clean(env.REDIS_PORT) ?? clean(defaults.port) ?? '6379';
  const db = clean(env.REDIS_DB) ?? (defaults.db !== undefined ? String(defaults.db) : '0');
  const password = clean(env.REDIS_PASSWORD);
  const scheme = clean(env.REDIS_TLS) === 'true' ? 'rediss' : 'redis';
  const auth = password ? `:${encodeUserInfo(password)}@` : '';

  return {
    url: `${scheme}://${auth}${host}:${port}/${db}`,
    source: host.includes('.svc.') || host.includes('cluster.local') ? 'in-cluster' : 'local-default',
    db: Number(db) || 0,
    tls: scheme === 'rediss',
  };
}

// ── Kafka ───────────────────────────────────────────────────────────────────

export type KafkaClusterName = 'events' | 'hlf';

export type KafkaEndpoint = {
  brokers: string[];
  source: EndpointSource;
};

export function resolveKafkaEndpoint(
  cluster: KafkaClusterName,
  env: Env = process.env,
  defaults: { brokers?: string } = {},
): KafkaEndpoint {
  const upper = cluster.toUpperCase();
  const tiers: Array<{ source: EndpointSource; keys: string[] }> = [
    { source: 'cloud', keys: [`KAFKA_${upper}_CLOUD_BROKERS`, `KAFKA_${upper}_MANAGED_BROKERS`] },
    { source: 'explicit', keys: [`KAFKA_${upper}_BROKERS`, `KAFKA_${upper}_BROKER`] },
  ];

  // Legacy shared aliases only apply to the events cluster, matching the
  // historical behaviour where every producer defaulted to it.
  if (cluster === 'events') {
    tiers.push({ source: 'in-cluster', keys: ['KAFKA_BROKERS', 'KAFKA_BROKER'] });
  }

  const chain = resolveChain(env, tiers);
  const raw = chain.value ?? clean(defaults.brokers);
  const source: EndpointSource = chain.value ? chain.source : raw ? 'local-default' : 'unset';

  const brokers = (raw ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  return { brokers, source };
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * One-line summary of where each endpoint came from. Log this at startup so a
 * service that silently fell back to localhost is obvious.
 */
export function describeEndpoints(env: Env = process.env): string {
  const pg = resolvePostgresEndpoint(env);
  const redis = resolveRedisEndpoint(env);
  const events = resolveKafkaEndpoint('events', env);
  const hlf = resolveKafkaEndpoint('hlf', env);

  const redact = (value: string) => value.replace(/\/\/[^@]*@/, '//***@');

  return [
    `postgres[${pg.source || 'unset'}]`,
    `redis[${redis.source}]`,
    `kafka.events[${events.source}]`,
    `kafka.hlf[${hlf.source}]`,
    `redis.url=${redact(redis.url) || '(unset)'}`,
    `kafka.events.brokers=${events.brokers.join('|') || '(unset)'}`,
    `kafka.hlf.brokers=${hlf.brokers.join('|') || '(unset)'}`,
  ].join(' ');
}
