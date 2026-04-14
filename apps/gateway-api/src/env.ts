import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
  PORT: z.coerce.number().int().positive().optional().default(3000),
  DATABASE_URL: z
    .string()
    .optional()
    .default('postgres://roadwatch_admin:development_password@localhost:5432/roadwatch_local'),
  JWT_SECRET: z.string().optional().default('local_development_cryptographic_secret'),
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

  // Comma-separated priority list, e.g. "gemini,ollama,llamacpp"
  LLM_FALLBACK_ORDER: z.string().optional().default('gemini,ollama,llamacpp')
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  // eslint-disable-next-line no-process-env
  return envSchema.parse(process.env);
}
