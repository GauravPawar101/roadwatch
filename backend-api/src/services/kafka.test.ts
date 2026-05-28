import { afterEach, describe, expect, it, vi } from 'vitest';

const publish = vi.hoisted(() => vi.fn());

vi.mock('../../../providers/kafka/KafkaProducer.js', () => ({
  KafkaProducer: vi.fn(() => ({ publish }))
}));

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