import { afterEach, describe, expect, it, vi } from 'vitest';

const publish = vi.hoisted(() => vi.fn());

// kafka.ts imports KafkaProducer from @roadwatch/kafka. The previous mock
// targeted providers/kafka/KafkaProducer.js, which does not exist in this
// workspace layout, so the real producer ran and demanded a live broker.
vi.mock('@roadwatch/kafka', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roadwatch/kafka')>();
  return {
    ...actual,
    KafkaProducer: vi.fn(() => ({ publish })),
  };
});

import { emitComplaintEvent } from './kafka.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.KAFKA_BROKERS;
  delete process.env.KAFKA_BROKER;
  delete process.env.KAFKA_TOPIC_COMPLAINTS;
});

describe('emitComplaintEvent', () => {
  it('publishes through the shared Kafka producer', async () => {
    process.env.KAFKA_TOPIC_COMPLAINTS = 'complaint-submitted';

    await emitComplaintEvent({ id: 'complaint-1' }, 'complaint-submitted', {
      key: 'complaint-1',
      headers: { source: 'backend-api' }
    });

    expect(publish).toHaveBeenCalledWith('complaint-submitted', { id: 'complaint-1' }, {
      key: 'complaint-1',
      headers: { source: 'backend-api' }
    });
  });
});