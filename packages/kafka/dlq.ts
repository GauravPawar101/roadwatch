import { randomUUID } from 'node:crypto';
import type { DlqEvent } from './topics.js';
import { KafkaTopics } from './topics.js';

export type PublishDlqInput = {
  originalTopic: string;
  consumerId: string;
  attempts: number;
  error: string;
  rawMessage: unknown;
  publish: (topic: string, payload: DlqEvent) => Promise<void>;
};

/**
 * Publish a structured dead-letter event to `dlq-events` (both Kafka clusters).
 */
export async function publishDlqEvent(input: PublishDlqInput): Promise<void> {
  const event: DlqEvent = {
    type: 'dlq-events',
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
    version: 1,
    originalTopic: input.originalTopic,
    consumerId: input.consumerId,
    attempts: input.attempts,
    error: input.error,
    rawMessage: input.rawMessage
  };
  await input.publish(KafkaTopics.dlq, event);
}

/** Outbox rows move to DEAD after this many failed publish attempts. */
export const OUTBOX_MAX_ATTEMPTS_BEFORE_DEAD = 10;
