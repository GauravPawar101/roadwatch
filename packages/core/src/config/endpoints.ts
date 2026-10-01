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
  tiers: Array<{
    source: EndpointSource;
    keys: string[];
    /**
     * Supplies the tier's value when no key matched. Needed because a provider
     * can hand out credentials in a form the connection string is derived
     * from, rather than as the connection string itself.
     */
    derive?: (env: Env) => string | undefined;
  }>,
): ResolvedEndpoint {
  const consulted = tiers.flatMap((t) => t.keys);
  for (const tier of tiers) {
    for (const key of tier.keys) {
      const value = clean(env[key]);
      if (value !== undefined) {
        return { value, source: tier.source, consulted };
      }
    }
    // Checked only after every key in the tier missed, so an explicit value
    // always wins over a derived one.
    const derived = tier.derive?.(env);
    if (derived !== undefined) {
      return { value: derived, source: tier.source, consulted };
    }
  }
  return { value: undefined, source: 'unset', consulted };
}

/**
 * Builds a `rediss://` URL from the Upstash *REST* credentials.
 *
 * Upstash hands out two views of the same database: a REST endpoint
 * (`https://<host>.upstash.io` plus a token) and a TCP/TLS endpoint. The
 * client here is ioredis, which speaks the TCP protocol, so a REST URL cannot
 * be used directly — the failure mode is an unhelpful connection error rather
 * than a clear "wrong endpoint type".
 *
 * The two share a host and the same token, so the TCP URL is derivable.
 * Accepting the REST pair avoids making the operator re-derive a credential
 * they already hold, which is the step most likely to be done wrong.
 *
 * Returns undefined when either value is missing or the URL is unusable.
 */
export function deriveUpstashTcpUrl(
  restUrl: string | undefined,
  token: string | undefined,
): string | undefined {
  const rawUrl = restUrl?.trim();
  const secret = token?.trim();
  if (!rawUrl || !secret) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  if (!parsed.hostname) return undefined;

  return `rediss://default:${encodeURIComponent(secret)}@${parsed.hostname}:6379`;
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
  // Prefer PgBouncer when available to avoid exhausting Postgres connections.
  const host = clean(env.PGBOUNCER_HOST) ?? clean(env.POSTGRES_HOST) ?? clean(env.PGHOST) ?? clean(defaults.host);
  const port = clean(env.PGBOUNCER_PORT) ?? clean(env.POSTGRES_PORT) ?? clean(env.PGPORT) ?? clean(defaults.port);
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
    {
      source: 'cloud',
      keys: ['REDIS_CLOUD_URL', 'REDIS_MANAGED_URL'],
      // The REST credential pair is a second, derived way to name the same
      // managed database. Resolving it here rather than in the Redis client
      // keeps this the single answer to "which endpoint will we dial" — a
      // reporter and a client that computed it separately would eventually
      // disagree, and the log would name the wrong endpoint.
      derive: env2 => deriveUpstashTcpUrl(env2.UPSTASH_REDIS_REST_URL, env2.UPSTASH_REDIS_REST_TOKEN),
    },
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
  redis: ['REDIS_CLOUD_URL', 'REDIS_MANAGED_URL', 'UPSTASH_REDIS_REST_URL'],
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

/**
 * True when the broker list looks like a managed cluster, which means TLS.
 *
 * The signal is the brokers themselves rather than which variable supplied them:
 * a managed cluster is named by its hostname, and an on-device stack is reached
 * over loopback. Keying off the variable name instead would be wrong, because a
 * managed cluster can perfectly well be named in `KAFKA_EVENTS_BROKERS` — the
 * "explicit" tier describes precedence, not whether the endpoint is remote.
 */
export function brokersSuggestTls(brokers: string[]): boolean {
  if (brokers.length === 0) return false;
  // Every broker, not any: a list mixing a loopback broker with a remote one is
  // a configuration error, and "some are remote" would then justify TLS for a
  // list that cannot succeed either way. Being strict keeps the answer
  // explainable.
  return brokers.every(b => {
    // A bracketed IPv6 literal carries its own colons, so the port cannot be
    // stripped by looking for a trailing `:\d+` — `[::1]:9092` would otherwise
    // reduce to `::1]` and match nothing.
    const host = /^\[(.+)\](?::\d+)?$/.exec(b)?.[1] ?? b.replace(/:\d+$/, '');
    if (/^(localhost|127\.|0\.0\.0\.0|::1|host\.containers\.internal)$/i.test(host)) return false;
    // The .svc. and .cluster.local forms are in-cluster names, resolved by the
    // cluster DNS rather than dialled across the network.
    if (/\.svc\.|\.cluster\.local$|\.local$/.test(host)) return false;
    // A bare RFC1918 address is a host on the local network, which is what an
    // in-cluster or LAN deployment uses; a public name is a managed cluster.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
    return true;
  });
}

/**
 * Diagnoses a TLS setting that contradicts the brokers it will be used against.
 *
 * A single `KAFKA_SSL` flag cannot be correct for every deployment: managed
 * clusters require TLS and refuse plaintext, while the on-device compose stack
 * is plaintext and has no certificate to present. Setting the flag once for the
 * managed case silently breaks the local case, and leaving it off silently
 * breaks the managed one. Both failures are quiet — a TLS handshake against a
 * plaintext broker retries until it gives up, long after the misconfiguration.
 *
 * Only the contradiction is reported. An explicit setting is never overridden
 * and never throws here: the operator may know something the broker list cannot
 * express, such as a sidecar terminating TLS.
 *
 * Returns undefined when the setting is absent or consistent.
 */
export function describeKafkaTlsProblem(
  cluster: 'events' | 'hlf',
  env: Env = process.env,
): string | undefined {
  const upper = cluster.toUpperCase();
  const { brokers } = resolveKafkaEndpoint(cluster, env);
  const raw = env[`KAFKA_${upper}_SSL`] ?? env.KAFKA_SSL;
  if (raw === undefined || brokers.length === 0) return undefined;

  const named = env[`KAFKA_${upper}_SSL`] !== undefined ? `KAFKA_${upper}_SSL` : 'KAFKA_SSL';
  const on = /^(1|true|yes|on)$/i.test(raw.trim());
  const wantTls = brokersSuggestTls(brokers);

  if (wantTls && !on) {
    return `${named}=false but the ${cluster} brokers (${brokers.join(', ')}) are remote, and managed clusters refuse plaintext connections`;
  }
  if (!wantTls && on) {
    return (
      `${named}=true but the ${cluster} brokers (${brokers.join(', ')}) are on-device and plaintext. ` +
      `A TLS handshake against them will not succeed — either point at a managed cluster or set ${named}=false`
    );
  }
  return undefined;
}

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
    // A TLS setting that cannot work against the tier it was applied to is
    // reported whatever the tier, so it is checked first.
    const tlsProblem =
      component === 'kafka.events' || component === 'kafka.hlf'
        ? describeKafkaTlsProblem(component === 'kafka.events' ? 'events' : 'hlf', env)
        : undefined;
    if (tlsProblem) {
      gaps.push({ component, variables: [...variables], problem: tlsProblem });
      continue;
    }

    if (resolved[component]) {
      // The tier resolved, but the value actually in force may still be
      // unusable. Validate the resolved value rather than re-reading the
      // variables: the value in force can be a *derived* one, and validating
      // the input instead would report a problem with a URL that is never
      // dialled.
      const inForce = resolvedValueFor(component, env);
      if (inForce !== undefined) {
        const problem = managedValueProblem(component, inForce);
        if (problem) gaps.push({ component, variables: [...variables], problem });
      }
      continue;
    }

    // Not resolved to the managed tier. A managed variable may still be set —
    // to a value too broken to be chosen, in which case the tier was rejected
    // and something else is being dialled.
    const configured = variables.map((k: string) => clean(env[k])).find(v => v !== undefined);
    if (configured) {
      gaps.push({
        component,
        variables: [...variables],
        problem: managedValueProblem(component, configured) ?? 'did not resolve',
      });
      continue;
    }
    gaps.push({ component, variables: [...variables] });
  }
  return gaps;
}

/**
 * The value in force for a component, as the resolver returns it — which may be
 * derived rather than read from a variable.
 *
 * Returning the resolver's own answer is what keeps the report honest: the
 * alternative is re-reading the variables, which reports on a value that may
 * not be the one dialled, and misses a value that was never named by a variable
 * at all.
 */
function resolvedValueFor(component: ManagedEndpointComponent, env: Env): string | undefined {
  switch (component) {
    case 'postgres':
      return resolvePostgresEndpoint(env).connectionString;
    case 'redis':
      return resolveRedisEndpoint(env).url;
    case 'kafka.events':
    case 'kafka.hlf': {
      const { brokers } = resolveKafkaEndpoint(
        component === 'kafka.events' ? 'events' : 'hlf',
        env,
      );
      return brokers.length > 0 ? brokers.join(',') : undefined;
    }
  }
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
