function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export type RedisConfig = {
  url: string;
};

let cached: RedisConfig | null = null;

export function isRedisConfigured(env: RedisEnv = process.env): boolean {
  return Boolean(env.REDIS_URL?.trim() || env.REDIS_URI?.trim() || env.REDIS_HOST?.trim());
}

export function getRedisConfig(env: RedisEnv = process.env): RedisConfig {
  if (cached) return cached;

  const url = env.REDIS_URL?.trim() || env.REDIS_URI?.trim();
  if (url) {
    cached = { url };
    return cached;
  }

  const host = requireEnv(env.REDIS_HOST, 'REDIS_HOST');
  const port = env.REDIS_PORT?.trim() || '6379';
  const password = env.REDIS_PASSWORD?.trim();
  const database = env.REDIS_DB?.trim() || '0';
  const auth = password ? `:${encodeURIComponent(password)}@` : '';
  cached = { url: `redis://${auth}${host}:${port}/${database}` };
  return cached;
}

type RedisEnv = NodeJS.ProcessEnv;
