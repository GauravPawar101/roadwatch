import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
  PORT: z.coerce.number().int().positive().optional().default(3100),
  // Bind address — use 0.0.0.0 so Docker workers can reach the gateway via host.docker.internal
  HOST: z.string().optional().default('127.0.0.1'),

  // PostgreSQL (use a PgBouncer-backed pooled endpoint)
  DATABASE_URL: z.string().optional().default('postgresql://postgres:postgres@127.0.0.1:16432/roadwatch'),
  POSTGRES_HOST: z.string().optional().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().positive().optional().default(5432),
  POSTGRES_DB: z.string().optional().default('roadwatch'),
  POSTGRES_USER: z.string().optional().default('postgres'),
  POSTGRES_PASSWORD: z.string().optional().default('postgres'),
  POSTGRES_SSL: z.coerce.boolean().optional().default(false),
  POSTGRES_POOL_MAX: z.coerce.number().int().positive().optional().default(10),

  JWT_SECRET: z.string().optional().default('local_development_cryptographic_secret'),
  ACCESS_SECRET: z.string().optional().default('local_development_cryptographic_secret'),
  REFRESH_SECRET: z.string().optional().default('local_development_cryptographic_secret'),
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

export function getEnv(): Env {
  // eslint-disable-next-line no-process-env
  if (process.env.ACCESS_SECRET && !process.env.ACCESS_SECRET) {
    process.env.ACCESS_SECRET = process.env.ACCESS_SECRET;
  }
  return envSchema.parse(process.env);
}

export function assertRequiredInfrastructure(): void {
  const env = process.env;

  const redisConfigured = Boolean((env.REDIS_URL ?? env.REDIS_URI ?? env.REDIS_HOST)?.toString().trim());
  if (!redisConfigured) {
    throw new Error('Redis is required but not configured. Set REDIS_URL or REDIS_HOST/REDIS_PORT');
  }

  const localKafkaConfigured = Boolean((env.KAFKA_BROKERS ?? env.KAFKA_BROKER ?? '').trim());

  if (!localKafkaConfigured) {
    throw new Error('Kafka is required but KAFKA_BROKER or KAFKA_BROKERS is missing');
  }
}