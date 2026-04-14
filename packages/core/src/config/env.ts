import Config from 'react-native-config';

/**
 * Structural definition arrays mapping physical secrets stringently.
 */
const requiredEnvVars = [
  'GEMINI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'API_GATEWAY_URL',
  'CLOUDFLARE_R2_PUBLIC_URL'
] as const;

// TypeScript explicitly enforces type inferences across these values natively
export type EnvKeys = typeof requiredEnvVars[number];
export type AppEnvironment = Record<EnvKeys, string>;

/**
 * Strict Physical Schema Validator organically triggering crash algorithms cleanly gracefully.
 */
function validateEnv(): AppEnvironment {
  const env: Partial<AppEnvironment> = {};

  // Pure mathematical iteration logically checking bounded structures explicitly cleanly
  for (const key of requiredEnvVars) {
    const value = Config[key];
    
    // Generates an outright fatal error natively completely blocking application launch internally
    if (!value || value.trim() === '') {
      throw new Error(`[Fatal Logical Vault Fault]: Native application startup halted absolutely efficiently. Missing explicitly strictly required variable mathematically natively: ${key}`);
    }
    
    env[key] = value;
  }

  return env as AppEnvironment;
}

// Structurally executes memory locks exactly once instantly upon Node compilation statically.
export const validatedEnv = validateEnv();
