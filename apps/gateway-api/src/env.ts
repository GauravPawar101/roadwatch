import { resolveKafkaEndpoint, resolveRedisEndpoint } from '@roadwatch/core';
import { z } from 'zod';

const DEV_FALLBACK_SECRET = 'local_development_cryptographic_secret';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
  PORT: z.coerce.number().int().positive().optional().default(3100),
  // Bind address — use 0.0.0.0 so Docker workers can reach the gateway via host.docker.internal
  HOST: z.string().optional().default('127.0.0.1'),

  // PostgreSQL (use a PgBouncer-backed pooled endpoint)
  DATABASE_URL: z.string().optional().default('postgresql://postgres:postgres@127.0.0.1:16432/roadwatch'),
  // Managed database (RDS/CloudSQL/Neon). Takes precedence over DATABASE_URL
  // when set — see resolvePostgresEndpoint in @roadwatch/core.
  DATABASE_CLOUD_URL: z.string().optional(),
  POSTGRES_CLOUD_URL: z.string().optional(),
  POSTGRES_HOST: z.string().optional().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().positive().optional().default(5432),
  POSTGRES_DB: z.string().optional().default('roadwatch'),
  POSTGRES_USER: z.string().optional().default('postgres'),
  POSTGRES_PASSWORD: z.string().optional().default('postgres'),
  POSTGRES_SSL: z.coerce.boolean().optional().default(false),
  POSTGRES_POOL_MAX: z.coerce.number().int().positive().optional().default(10),

  // Redis: managed (ElastiCache/Memorystore/Upstash) or in-cluster/local.
  REDIS_URL: z.string().optional(),
  REDIS_CLOUD_URL: z.string().optional(),
  REDIS_MANAGED_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),
  REDIS_DB: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.coerce.boolean().optional().default(false),

  // Kafka: managed MSK/Confluent first, then in-cluster, then local.
  KAFKA_EVENTS_BROKERS: z.string().optional(),
  KAFKA_EVENTS_CLOUD_BROKERS: z.string().optional(),
  KAFKA_EVENTS_MANAGED_BROKERS: z.string().optional(),
  KAFKA_HLF_BROKERS: z.string().optional(),
  KAFKA_HLF_CLOUD_BROKERS: z.string().optional(),
  KAFKA_HLF_MANAGED_BROKERS: z.string().optional(),
  KAFKA_BROKERS: z.string().optional(),
  KAFKA_BROKER: z.string().optional(),

  JWT_SECRET: z.string().optional().default(DEV_FALLBACK_SECRET),
  // No literal defaults here on purpose: these fall back to JWT_SECRET in
  // getEnv() so that setting only JWT_SECRET is sufficient. A hardcoded default
  // would always be truthy and silently sign tokens with a publicly known secret.
  ACCESS_SECRET: z.string().optional(),
  REFRESH_SECRET: z.string().optional(),
  ACCESS_TOKEN_EXPIRES_MINUTES: z.coerce.number().int().positive().optional().default(15),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().optional().default(7),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().optional().default(300),
  ALLOW_DEV_OTP_ECHO: z.coerce.boolean().optional().default(true),

  // PII protection
  // PHONE_HASH_PEPPER: secret for HMAC(phone) lookup keys
  // PHONE_ENC_KEY: base64 for 32-byte AES-256-GCM key
  PHONE_HASH_PEPPER: z.string().optional(),
  PHONE_ENC_KEY: z.string().optional(),

  // Notifications
  NOTIFICATIONS_DISPATCHER_ENABLED: z.string().optional().default('false'),
  NOTIFICATIONS_DISPATCHER_INTERVAL_MS: z.string().optional().default('60000'),

  // FCM
  FCM_SERVER_KEY: z.string().optional(),

  // SMS
  SMS_PROVIDER: z.enum(['twilio', 'msg91']).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),

  // WhatsApp
  WHATSAPP_PROVIDER: z.enum(['twilio']).optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  // LLM (Gemini primary; Ollama/llama.cpp fallback)
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional().default('gemini-2.0-flash'),
  GEMINI_API_BASE_URL: z.string().optional().default('https://generativelanguage.googleapis.com/v1beta'),

  // OpenAI-compatible endpoints (recommended for llama.cpp servers; can also be used for Ollama if enabled)
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().optional().default('llama3.1'),

  LLAMACPP_BASE_URL: z.string().optional(),
  LLAMACPP_MODEL: z.string().optional().default('llama'),

  // Supabase Storage
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().optional().default('roadwatch-media'),

  // Comma-separated priority list, e.g. "gemini,ollama,llamacpp"
  LLM_FALLBACK_ORDER: z.string().optional().default('gemini,ollama,llamacpp')
});

export type Env = z.infer<typeof envSchema>;

/**
 * `Env` after getEnv() has resolved the signing secrets. ACCESS_SECRET and
 * REFRESH_SECRET are always populated (falling back to JWT_SECRET), so callers
 * can rely on them without re-checking for undefined.
 */
export type ResolvedEnv = Env & { ACCESS_SECRET: string; REFRESH_SECRET: string };

export function getEnv(): ResolvedEnv {
  const parsed = envSchema.parse(process.env);
  return {
    ...parsed,
    // Fall back to JWT_SECRET so a single configured secret is honoured.
    ACCESS_SECRET: parsed.ACCESS_SECRET || parsed.JWT_SECRET,
    REFRESH_SECRET: parsed.REFRESH_SECRET || parsed.JWT_SECRET,
  };
}

/**
 * Refuse to boot in production while any signing secret is still the built-in
 * development fallback. Without this, a deployment that sets only one of
 * JWT_SECRET/ACCESS_SECRET/REFRESH_SECRET silently signs tokens with a secret
 * that is published in this repository.
 */
export function assertNoDevSecretsInProduction(env: ResolvedEnv): void {
  if (env.NODE_ENV !== 'production') return;
  const weak = (['JWT_SECRET', 'ACCESS_SECRET', 'REFRESH_SECRET'] as const).filter(
    (key) => env[key] === DEV_FALLBACK_SECRET
  );
  if (weak.length > 0) {
    throw new Error(
      `Refusing to start: ${weak.join(', ')} still use the built-in development secret. ` +
        'Set strong, unique values before running with NODE_ENV=production.'
    );
  }
}

/**
 * Fails fast when a hard dependency has no reachable endpoint under the shared
 * precedence chain.
 *
 * This used to test only REDIS_URL/REDIS_HOST and KAFKA_BROKERS/KAFKA_BROKER.
 * That made it cloud-blind: a deployment configured solely with a managed
 * Redis (REDIS_CLOUD_URL) and managed Kafka (KAFKA_EVENTS_CLOUD_BROKERS) was
 * declared "not configured" and refused to boot, even though both were fully
 * specified. Resolution now goes through the same resolvers the connection
 * code uses, so the check and the dial can no longer disagree.
 */
export function assertRequiredInfrastructure(env: NodeJS.ProcessEnv = process.env): void {
  const redis = resolveRedisEndpoint(env);
  if (!redis.url) {
    throw new Error(
      'Redis is required but not configured. Set REDIS_CLOUD_URL or REDIS_MANAGED_URL for a ' +
        'managed instance, REDIS_URL for an explicit endpoint, or REDIS_HOST (+ REDIS_PORT) ' +
        'for a local one.',
    );
  }

  const events = resolveKafkaEndpoint('events', env);
  if (events.brokers.length === 0) {
    throw new Error(
      'Kafka is required but not configured. Set KAFKA_EVENTS_CLOUD_BROKERS for a managed ' +
        'cluster, KAFKA_EVENTS_BROKERS for an explicit endpoint, or KAFKA_BROKERS / ' +
        'KAFKA_BROKER for a local one.',
    );
  }
}