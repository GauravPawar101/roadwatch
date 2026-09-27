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

/** Managed-tier variable names, per component, in precedence order. */
const MANAGED_KEYS = {
  postgres: ['DATABASE_CLOUD_URL', 'POSTGRES_CLOUD_URL'],
  redis: ['REDIS_CLOUD_URL', 'REDIS_MANAGED_URL'],
  'kafka.events': ['KAFKA_EVENTS_CLOUD_BROKERS', 'KAFKA_EVENTS_MANAGED_BROKERS'],
  'kafka.hlf': ['KAFKA_HLF_CLOUD_BROKERS', 'KAFKA_HLF_MANAGED_BROKERS'],
} as const satisfies Record<string, readonly string[]>;

export type ManagedEndpointComponent = keyof typeof MANAGED_KEYS;

export type ManagedEndpointGap = {
  component: ManagedEndpointComponent;
  /** Variables that would enable the managed tier for this component. */
  variables: string[];
  /**
   * Why the configured managed value is unusable, or undefined when the
   * component simply has no managed endpoint — which is normal on a
   * device-local run.
   *
   * A managed variable that is merely *set* cannot fail to resolve: any
   * non-empty value becomes the resolved URL. The real mistakes are subtler and
   * were previously invisible:
   *
   *   - a malformed value that never had a scheme, so it cannot be dialled;
   *   - a managed value pointing at loopback, which is almost always a
   *     placeholder that was never replaced;
   *   - a managed Postgres URL without TLS, which every hosted provider
   *     refuses;
   *   - a managed Redis URL that is not TLS, which Upstash requires;
   *   - SASL credentials configured with no managed brokers, or brokers with
   *     no credentials.
   */
  problem?: string;
};

/** True for a value that clearly names a local machine rather than a provider. */
function looksLocal(value: string): boolean {
  return /@(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/i.test(value);
}

/**
 * Inspects a managed value for the mistakes that actually occur, and returns a
 * description of the first problem found.
 */
function managedValueProblem(component: ManagedEndpointComponent, value: string): string | undefined {
  if (component === 'kafka.events' || component === 'kafka.hlf') {
    const hosts = value.split(',').map(h => h.trim()).filter(Boolean);
    if (hosts.length === 0) return 'no broker hosts';
    for (const host of hosts) {
      // A provider is always host:port; a bare hostname cannot be dialled.
      if (!/:\d+$/.test(host)) return `broker "${host}" has no port`;
    }
    // Hosted providers listen on 9094 with SASL; a plaintext 9092 entry is the
    // local convention and will be refused.
    const plaintext = hosts.filter(h => h.endsWith(':9092'));
    if (plaintext.length > 0) {
      return `broker(s) ${plaintext.join(', ')} use port 9092; managed clusters need 9094 with TLS`;
    }
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'value is not a valid URL (no scheme, e.g. it needs postgres:// or rediss://)';
  }

  if (looksLocal(value)) return 'points at localhost, which looks like an unreplaced placeholder';

  if (component === 'postgres' && !/^postgres(ql)?:$/i.test(parsed.protocol)) {
    return `scheme ${parsed.protocol} is not a Postgres scheme`;
  }
  if (component === 'redis' && !/^rediss?:$/.test(parsed.protocol)) {
    return `scheme ${parsed.protocol} is not a Redis scheme`;
  }
  if (component === 'postgres' && parsed.protocol === 'postgresql:') {
    // Neon, RDS, Cloud SQL and Supabase all refuse plaintext connections.
    if (!/sslmode=(require|verify-ca|verify-full)/i.test(value)) {
      return 'no sslmode=require; managed Postgres refuses plaintext connections';
    }
  }
  if (component === 'redis' && parsed.protocol === 'redis:') {
    return 'scheme is redis:// but managed caches (Upstash, ElastiCache with TLS) require rediss://';
  }
  return undefined;
}

/**
 * Reports which components have no managed endpoint, and flags any managed
 * value that looks wrong.
 *
 * The precedence chain already falls back to the in-cluster or local default
 * when the cloud tier is absent, which is what makes local development and the
 * in-cluster deployment work with no cloud account at all. The cost is that the
 * fallback is silent: a typo, a placeholder that was never replaced, or a
 * missing `sslmode` all look exactly like a deployment that never intended to
 * use a managed service. This makes the difference visible.
 */
export function describeManagedEndpointGaps(env: Env = process.env): ManagedEndpointGap[] {
  const resolved: Record<ManagedEndpointComponent, boolean> = {
    postgres: resolvePostgresEndpoint(env).source === 'cloud',
    redis: resolveRedisEndpoint(env).source === 'cloud',
    'kafka.events': resolveKafkaEndpoint('events', env).source === 'cloud',
    'kafka.hlf': resolveKafkaEndpoint('hlf', env).source === 'cloud',
  };

  const gaps: ManagedEndpointGap[] = [];
  for (const [component, variables] of Object.entries(MANAGED_KEYS) as Array<
    [ManagedEndpointComponent, readonly string[]]
  >) {
    if (resolved[component]) {
      // The tier resolved, but the value may still be unusable.
      const configured = variables.map(k => clean(env[k])).find(v => v !== undefined);
      if (configured) {
        const problem = managedValueProblem(component, configured);
        if (problem) gaps.push({ component, variables: [...variables], problem });
      }
      continue;
    }

    const configured = variables.map(k => clean(env[k])).find(v => v !== undefined);
    if (configured) {
      gaps.push({ component, variables: [...variables], problem: managedValueProblem(component, configured) ?? 'did not resolve' });
      continue;
    }
    gaps.push({ component, variables: [...variables] });
  }
  return gaps;
}

/**
 * One log-safe line naming the components that will run on-device, and flagging
 * any that look misconfigured. Contains no values, only variable names.
 */
export function formatManagedEndpointGaps(gaps: ManagedEndpointGap[]): string {
  if (gaps.length === 0) return 'all managed endpoints configured';

  const onDevice = gaps.filter(g => !g.problem);
  const broken = gaps.filter(g => g.problem);

  const parts: string[] = [];
  if (onDevice.length > 0) {
    parts.push(
      `on-device fallback for ${onDevice.map(g => g.component).join(', ')} ` +
      `(set ${onDevice.map(g => g.variables[0]).join(' / ')} to use a managed one)`
    );
  }
  if (broken.length > 0) {
    parts.push(
      `MANAGED ENDPOINT PROBLEM: ` +
      broken.map(g => `${g.component} — ${g.problem} (from ${g.variables.join('/')})`).join('; ')
    );
  }
  return parts.join('; ');
}

/**
 * Opt-in strict mode: refuse to start when a managed endpoint is configured
 * incorrectly. A component with nothing set is still allowed, so a fully local
 * deployment keeps working.
 *
 * Set INFRA_REQUIRE_MANAGED=true in environments where managed endpoints are
 * expected, so a placeholder that was never replaced fails the deployment
 * instead of quietly pointing at the in-cluster service.
 */
export function assertManagedEndpoints(env: Env = process.env): void {
  if (!/^(1|true|yes|on)$/i.test(clean(env.INFRA_REQUIRE_MANAGED) ?? '')) return;

  const broken = describeManagedEndpointGaps(env).filter(g => g.problem);
  if (broken.length === 0) return;

  throw new Error(
    `INFRA_REQUIRE_MANAGED is set and a managed endpoint is unusable: ` +
    `${formatManagedEndpointGaps(broken)}. Refusing to start rather than falling back silently.`
  );
}

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
