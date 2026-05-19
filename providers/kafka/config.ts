function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export type UpstashKafkaConfig = {
  url: string;
  username: string;
  password: string;
};

let cachedUpstash: UpstashKafkaConfig | null = null;

export function isUpstashKafkaConfigured(env: KafkaEnv = process.env): boolean {
  return Boolean(
    env.UPSTASH_KAFKA_REST_URL?.trim() &&
      ((env.UPSTASH_KAFKA_REST_USERNAME?.trim() && env.UPSTASH_KAFKA_REST_PASSWORD?.trim()) ||
        env.UPSTASH_KAFKA_REST_TOKEN?.trim())
  );
}

export function getKafkaConnectionMode(env: KafkaEnv = process.env): 'upstash' | 'local' {
  if (isUpstashKafkaConfigured(env)) return 'upstash';

  const brokers = getLocalKafkaBrokers(env);
  if (brokers) return 'local';

  throw new Error(
    'Kafka is required but neither Upstash Kafka REST credentials nor KAFKA_BROKER/KAFKA_BROKERS are configured'
  );
}

export function getUpstashKafkaConfig(env: KafkaEnv = process.env): UpstashKafkaConfig {
  if (cachedUpstash) return cachedUpstash;

  const url = requireEnv(env.UPSTASH_KAFKA_REST_URL, 'UPSTASH_KAFKA_REST_URL');

  // Upstash REST auth is HTTP Basic; some console UIs expose a single "token".
  // If provided, treat it as the Basic password and default the username to "token".
  const token = env.UPSTASH_KAFKA_REST_TOKEN?.trim();
  const username = token
    ? (env.UPSTASH_KAFKA_REST_USERNAME?.trim() || 'token')
    : requireEnv(env.UPSTASH_KAFKA_REST_USERNAME, 'UPSTASH_KAFKA_REST_USERNAME');
  const password = token ? token : requireEnv(env.UPSTASH_KAFKA_REST_PASSWORD, 'UPSTASH_KAFKA_REST_PASSWORD');

  cachedUpstash = { url, username, password };
  return cachedUpstash;
}

export function getLocalKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  const raw = (env.KAFKA_BROKERS ?? env.KAFKA_BROKER ?? '').trim();
  if (!raw) return null;
  const brokers = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return brokers.length > 0 ? brokers : null;
}

type KafkaEnv = NodeJS.ProcessEnv;
