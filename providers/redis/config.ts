function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export type UpstashRedisConfig = {
  url: string;
  token: string;
};

let cached: UpstashRedisConfig | null = null;

export function isUpstashRedisConfigured(env: RedisEnv = process.env): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

export function getUpstashRedisConfig(env: RedisEnv = process.env): UpstashRedisConfig {
  if (cached) return cached;

  const url = requireEnv(env.UPSTASH_REDIS_REST_URL, 'UPSTASH_REDIS_REST_URL');
  const token = requireEnv(env.UPSTASH_REDIS_REST_TOKEN, 'UPSTASH_REDIS_REST_TOKEN');

  cached = { url, token };
  return cached;
}

type RedisEnv = NodeJS.ProcessEnv;
