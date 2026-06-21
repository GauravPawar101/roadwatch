function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export function getKafkaConnectionMode(env: KafkaEnv = process.env): 'local' {
  const brokers = getLocalKafkaBrokers(env);
  if (brokers) return 'local';

  throw new Error('Kafka is required but KAFKA_BROKER or KAFKA_BROKERS is not configured');
}

export function getLocalKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  const raw = (env.KAFKA_BROKERS ?? env.KAFKA_BROKER ?? '127.0.0.1:9094').trim();
  if (!raw) return null;
  const brokers = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return brokers.length > 0 ? brokers : null;
}

type KafkaEnv = NodeJS.ProcessEnv;
