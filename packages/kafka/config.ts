export type KafkaEnv = NodeJS.ProcessEnv;

function parseBrokers(raw: string | undefined): string[] | null {
  if (!raw || raw.trim().length === 0) return null;
  const brokers = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return brokers.length > 0 ? brokers : null;
}

export function getKafkaConnectionMode(env: KafkaEnv = process.env): 'local' {
  if (getHlfKafkaBrokers(env) || getEventsKafkaBrokers(env) || getLocalKafkaBrokers(env)) {
    return 'local';
  }

  throw new Error(
    'Kafka is required but KAFKA_HLF_BROKERS, KAFKA_EVENTS_BROKERS, or KAFKA_BROKER(S) is not configured'
  );
}

/** HLF backpressure cluster — fabric-anchor ingestion only. */
export function getHlfKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return parseBrokers(env.KAFKA_HLF_BROKERS) ?? parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER);
}

/** Operational events cluster — SLA, notifications, triggers, webhook fan-out. */
export function getEventsKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return parseBrokers(env.KAFKA_EVENTS_BROKERS) ?? parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER);
}

/** @deprecated Prefer getHlfKafkaBrokers / getEventsKafkaBrokers. Defaults to events cluster. */
export function getLocalKafkaBrokers(env: KafkaEnv = process.env): string[] | null {
  return getEventsKafkaBrokers(env) ?? parseBrokers(env.KAFKA_BROKERS ?? env.KAFKA_BROKER ?? '127.0.0.1:9095');
}
