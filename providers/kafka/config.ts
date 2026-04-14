export type KafkaConfig = {
  url: string;
  username: string;
  password: string;
};

let cached: KafkaConfig | null = null;

function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export function getKafkaConfig(env: KafkaEnv = process.env): KafkaConfig {
  if (cached) return cached;

  const url = requireEnv(env.UPSTASH_KAFKA_REST_URL, 'UPSTASH_KAFKA_REST_URL');
  const username = requireEnv(env.UPSTASH_KAFKA_REST_USERNAME, 'UPSTASH_KAFKA_REST_USERNAME');
  const password = requireEnv(env.UPSTASH_KAFKA_REST_PASSWORD, 'UPSTASH_KAFKA_REST_PASSWORD');

  cached = { url, username, password };
  return cached;
}

type KafkaEnv = NodeJS.ProcessEnv;
