import 'dotenv/config';

import crypto from 'crypto';
import { Kafka } from 'kafkajs';

function getBrokers(): string[] {
  const raw = (process.env.KAFKA_BROKERS ?? process.env.KAFKA_BROKER ?? '127.0.0.1:9094').trim();
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseCount(): number {
  const idx = process.argv.findIndex(a => a === '--count');
  const raw = idx >= 0 ? process.argv[idx + 1] : undefined;
  const n = raw ? Number(raw) : 100;
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid --count value');
  return Math.floor(n);
}

async function main(): Promise<void> {
  const brokers = getBrokers();
  const count = parseCount();

  const kafka = new Kafka({ clientId: 'roadwatch-test-producer', brokers });
  const producer = kafka.producer({ allowAutoTopicCreation: true });

  await producer.connect();

  const messages = Array.from({ length: count }).map((_, i) => {
    const idempotencyKey = crypto.randomUUID();
    const complaintId = `test-${i + 1}`;
    return {
      key: idempotencyKey,
      value: JSON.stringify({ idempotencyKey, complaintId })
    };
  });

  await producer.send({ topic: 'complaint.submitted', messages });
  await producer.disconnect();

  console.log(`[produce-test-events] sent ${count} complaint.submitted messages to ${brokers.join(',')}`);
}

main().catch(err => {
  console.error('[produce-test-events] fatal:', err);
  process.exitCode = 1;
});
