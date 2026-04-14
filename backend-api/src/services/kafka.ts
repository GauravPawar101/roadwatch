import { Kafka } from 'kafkajs';

type UpstashProduceRequest = {
  topic: string;
  value: string;
  partition?: number;
  timestamp?: number;
  key?: string;
  headers?: Array<{ key: string; value: string }>;
};

function getUpstashBaseUrl(): string | undefined {
  const url = process.env.UPSTASH_KAFKA_REST_URL?.trim();
  if (!url) return undefined;
  return url.replace(/\/$/, '');
}

function getUpstashBasicAuthToken(): string | undefined {
  const directToken = process.env.UPSTASH_KAFKA_REST_TOKEN?.trim();
  if (directToken) return directToken;

  const username = process.env.UPSTASH_KAFKA_REST_USERNAME?.trim();
  const password = process.env.UPSTASH_KAFKA_REST_PASSWORD?.trim();
  if (!username || !password) return undefined;
  return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

async function upstashProduce(req: UpstashProduceRequest): Promise<void> {
  const baseUrl = getUpstashBaseUrl();
  const basicToken = getUpstashBasicAuthToken();
  if (!baseUrl) throw new Error('UPSTASH_KAFKA_REST_URL is required for Upstash Kafka REST mode');
  if (!basicToken)
    throw new Error(
      'UPSTASH_KAFKA_REST_TOKEN (preferred) or UPSTASH_KAFKA_REST_USERNAME + UPSTASH_KAFKA_REST_PASSWORD are required for Upstash Kafka REST mode'
    );

  const res = await fetch(`${baseUrl}/produce`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${basicToken}`
    },
    body: JSON.stringify(req),
    keepalive: true
  });

  const json = await res.json().catch(() => undefined);
  if (!res.ok) {
    const errorMessage =
      typeof json?.error === 'string'
        ? json.error
        : typeof json?.message === 'string'
          ? json.message
          : `Upstash Kafka REST produce failed with HTTP ${res.status}`;
    throw new Error(errorMessage);
  }
}

function parseBrokers(): string[] {
  const brokers = process.env.KAFKA_BROKERS ?? process.env.KAFKA_BROKER ?? 'localhost:9092';
  return brokers
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
}

function getKafkaJsProducer() {
  const saslUsername = process.env.KAFKA_SASL_USERNAME;
  const saslPassword = process.env.KAFKA_SASL_PASSWORD;
  const saslMechanism = (process.env.KAFKA_SASL_MECHANISM ?? 'scram-sha-256') as
    | 'plain'
    | 'scram-sha-256'
    | 'scram-sha-512'
    | 'aws';

  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'roadwatch-backend',
    brokers: parseBrokers(),
    ssl: Boolean(process.env.KAFKA_SSL) || (Boolean(saslUsername) && Boolean(saslPassword)),
    sasl:
      saslUsername && saslPassword
        ? {
            mechanism: saslMechanism,
            username: saslUsername,
            password: saslPassword
          }
        : undefined
  });

  return kafka.producer();
}

/**
 * Emits a complaint event.
 *
 * Preferred mode (Upstash REST):
 * - UPSTASH_KAFKA_REST_URL
 * - UPSTASH_KAFKA_REST_TOKEN  (base64(username:password) from Upstash console)
 *   OR UPSTASH_KAFKA_REST_USERNAME + UPSTASH_KAFKA_REST_PASSWORD
 *
 * Fallback mode (KafkaJS): broker/SASL env vars.
 */
export async function emitComplaintEvent(event: unknown) {
  const topic = process.env.KAFKA_TOPIC_COMPLAINTS?.trim() || 'complaints';

  if (getUpstashBaseUrl()) {
    await upstashProduce({ topic, value: JSON.stringify(event) });
    return;
  }

  const producer = getKafkaJsProducer();
  await producer.connect();
  try {
    await producer.send({
      topic,
      messages: [{ value: JSON.stringify(event) }]
    });
  } finally {
    await producer.disconnect();
  }
}
