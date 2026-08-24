#!/usr/bin/env node
/**
 * DLQ inspect / redrive tool.
 * list  — print recent dlq-events
 * redrive — republish rawMessage.value onto originalTopic (at-least-once)
 */
import { Kafka } from 'kafkajs';

const brokers = (process.env.KAFKA_EVENTS_BROKERS || process.env.KAFKA_BROKERS || '127.0.0.1:9095')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const topic = process.env.DLQ_TOPIC || 'dlq-events';
const action = process.argv[2] || 'list';

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const max = Number.parseInt(argValue('--max', '20'), 10) || 20;
const offset = argValue('--offset', '');
const dryRun = process.argv.includes('--dry-run');

const kafka = new Kafka({ clientId: 'roadwatch-dlq-redrive', brokers });
const consumer = kafka.consumer({ groupId: `dlq-redrive-${process.pid}` });
const producer = kafka.producer();

async function listRecent() {
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  const found = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), 8000);
    consumer
      .run({
        eachMessage: async ({ message, partition }) => {
          const value = message.value?.toString() || '';
          let parsed;
          try {
            parsed = JSON.parse(value);
          } catch {
            parsed = { raw: value };
          }
          found.push({
            partition,
            offset: message.offset,
            originalTopic: parsed.originalTopic,
            consumerId: parsed.consumerId,
            attempts: parsed.attempts,
            error: parsed.error,
            idempotencyKey: parsed.idempotencyKey
          });
          if (found.length >= max) {
            clearTimeout(timer);
            resolve(undefined);
          }
        }
      })
      .catch(reject);
  });
  await consumer.disconnect();
  console.log(JSON.stringify(found.slice(-max), null, 2));
}

async function redrive() {
  if (!offset) {
    console.error('redrive requires --offset <kafka-offset>');
    process.exit(1);
  }
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  let matched = null;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), 15000);
    consumer
      .run({
        eachMessage: async ({ message }) => {
          if (String(message.offset) !== String(offset)) return;
          matched = message.value?.toString() || '';
          clearTimeout(timer);
          resolve(undefined);
        }
      })
      .catch(reject);
  });

  if (!matched) {
    console.error(`No DLQ message at offset ${offset}`);
    process.exit(2);
  }

  const parsed = JSON.parse(matched);
  const originalTopic = parsed.originalTopic;
  const raw = parsed.rawMessage?.value ?? parsed.rawMessage;
  const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (!originalTopic) {
    console.error('DLQ payload missing originalTopic');
    process.exit(3);
  }

  console.log(`${dryRun ? '[dry-run] would redrive' : 'Redriving'} offset=${offset} -> ${originalTopic}`);
  if (!dryRun) {
    await producer.send({
      topic: originalTopic,
      messages: [{ key: parsed.rawMessage?.key ?? parsed.idempotencyKey, value }]
    });
  }
  await consumer.disconnect();
  await producer.disconnect();
}

if (action === 'list') {
  await listRecent();
} else if (action === 'redrive') {
  await redrive();
} else {
  console.error(`Unknown action: ${action}`);
  process.exit(1);
}
