import { claimIdempotencyKey } from '@roadwatch/redis';
import { getKafkaProducer } from './producer.js';

const DEFAULT_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type PublishKafkaEventOptions = {
  key?: string;
  headers?: Record<string, string>;
  /**
   * If set, we use Redis to dedupe publishes across retries.
   * Dedupe is fail-open (publish still happens if Redis is down).
   */
  idempotencyKey?: string;
  dedupeTtlSeconds?: number;
};

export async function publishKafkaEvent(topic: string, event: unknown, options?: PublishKafkaEventOptions): Promise<void> {
  if (options?.idempotencyKey) {
    const claim = await claimIdempotencyKey(
      `roadwatch:kafka:idempotency:${options.idempotencyKey}`,
      options.dedupeTtlSeconds ?? DEFAULT_DEDUPE_TTL_SECONDS
    );

    if (!claim.ok) {
      console.warn('[redis] idempotency claim failed; publishing anyway', claim.error);
    } else if (!claim.claimed) {
      return; // duplicate
    }
  }

  const producer = getKafkaProducer();
  await producer.publish(topic, event, { key: options?.key, headers: options?.headers });
}
