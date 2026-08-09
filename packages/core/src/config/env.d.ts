/**
 * Structural definition arrays mapping physical secrets stringently.
 */
declare const requiredEnvVars: readonly ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "API_GATEWAY_URL", "SUPABASE_STORAGE_BUCKET"];
export type EnvKeys = typeof requiredEnvVars[number];
export type AppEnvironment = Record<EnvKeys, string>;
export declare const validatedEnv: AppEnvironment;
export {};
//# sourceMappingURL=env.d.ts.map