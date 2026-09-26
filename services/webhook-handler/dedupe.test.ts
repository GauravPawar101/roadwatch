import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic stand-ins for Redis (SET NX semantics) and the pg pool.
const redisStore = new Map<string, string>();
const redisMock = vi.hoisted(() => ({
  claimIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  on: vi.fn(),
}));

const dlqPublish = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@roadwatch/redis', () => redisMock);
vi.mock('pg', () => ({ default: { Pool: vi.fn(() => poolMock) } }));
vi.mock('kafkajs', () => ({
  Kafka: vi.fn(() => ({
    producer: () => ({ connect: vi.fn(), send: dlqPublish }),
    consumer: () => ({ connect: vi.fn(), subscribe: vi.fn(), run: vi.fn(), disconnect: vi.fn() }),
  })),
}));

import { handleWithDedupe, idempotencyKeyFor } from './index.js';

const TOPIC = 'complaint-status-changed';

function msg(offset: string, key: string | null = 'complaint-1') {
  return {
    topic: TOPIC,
    partition: 0,
    offset,
    timestamp: '',
    key,
    value: JSON.stringify({ complaintId: 'complaint-1', toStatus: 'RESOLVED' }),
    headers: {},
  } as any;
}

beforeEach(() => {
  redisStore.clear();
  vi.clearAllMocks();
  poolMock.query.mockResolvedValue({ rows: [] });

  // SET key 1 EX ttl NX
  redisMock.claimIdempotencyKey.mockImplementation(async (key: string) => {
    if (redisStore.has(key)) return { ok: true, claimed: false };
    redisStore.set(key, '1');
    return { ok: true, claimed: true };
  });
  redisMock.releaseIdempotencyKey.mockImplementation(async (key: string) => {
    redisStore.delete(key);
  });
});

describe('idempotencyKeyFor', () => {
  it('keys on the Kafka message identity, not the business key', () => {
    expect(idempotencyKeyFor(TOPIC, 0, '101')).toBe(`roadwatch:webhook:idempotency:${TOPIC}:0:101`);
  });

  it('gives distinct keys to distinct events that share a business key', () => {
    // Every status change for a complaint is published with key = complaintId.
    const a = idempotencyKeyFor(TOPIC, 0, '101');
    const b = idempotencyKeyFor(TOPIC, 0, '102');
    expect(a).not.toBe(b);
  });
});

describe('handleWithDedupe', () => {
  it('processes a message the first time it is seen', async () => {
    const handled = await handleWithDedupe(msg('100'), TOPIC, 0, '100');
    expect(handled).toBe(true);
    expect(poolMock.query).toHaveBeenCalled();
  });

  it('skips a redelivery of an already-processed message', async () => {
    await handleWithDedupe(msg('100'), TOPIC, 0, '100');
    poolMock.query.mockClear();

    const handled = await handleWithDedupe(msg('100'), TOPIC, 0, '100');

    expect(handled).toBe(false);
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  /**
   * Regression: the claim used to be keyed on message.key (= complaintId) and was
   * never released, so only the first event per complaint was ever processed.
   */
  it('does not let one event suppress later events for the same complaint', async () => {
    const offsets = ['100', '101', '102', '103'];
    for (const offset of offsets) {
      const handled = await handleWithDedupe(msg(offset), TOPIC, 0, offset);
      expect(handled).toBe(true);
    }
    // Each event wrote its status-change notification.
    const statusUpdates = poolMock.query.mock.calls.filter((c) =>
      String(c[0]).includes('SET status = $1')
    );
    expect(statusUpdates.length).toBe(offsets.length);
  });

  /**
   * Regression: the claim was taken before the work and never released, so a
   * single transient failure made every redelivery look like a duplicate and the
   * message was dropped for the full TTL.
   */
  it('releases the claim when processing fails so the retry is not swallowed', async () => {
    poolMock.query.mockRejectedValueOnce(new Error('transient db error'));

    await expect(handleWithDedupe(msg('200'), TOPIC, 0, '200')).rejects.toThrow('transient db error');

    const key = idempotencyKeyFor(TOPIC, 0, '200');
    expect(redisMock.releaseIdempotencyKey).toHaveBeenCalledWith(key);
    expect(redisStore.has(key)).toBe(false);

    // The redelivery is accepted and succeeds.
    poolMock.query.mockResolvedValue({ rows: [] });
    const handled = await handleWithDedupe(msg('200'), TOPIC, 0, '200');
    expect(handled).toBe(true);
  });

  it('keeps the claim after a DLQ hand-off so the message is not replayed', async () => {
    // processMessage swallows the error once attempts are exhausted, so the
    // claim must survive.
    poolMock.query.mockRejectedValue(new Error('permanent failure'));
    for (let i = 0; i < 3; i++) {
      const key = idempotencyKeyFor(TOPIC, 0, '300');
      redisMock.claimIdempotencyKey.mockImplementationOnce(async (k: string) => {
        redisStore.set(k, '1');
        return { ok: true, claimed: true };
      });
      await handleWithDedupe(msg('300'), TOPIC, 0, '300').catch(() => undefined);
    }
    expect(redisStore.has(idempotencyKeyFor(TOPIC, 0, '300'))).toBe(true);
  });

  it('fails open when Redis is unavailable', async () => {
    redisMock.claimIdempotencyKey.mockRejectedValue(new Error('redis down'));
    redisMock.releaseIdempotencyKey.mockRejectedValue(new Error('redis down'));

    const handled = await handleWithDedupe(msg('400'), TOPIC, 0, '400');

    expect(handled).toBe(true);
    expect(poolMock.query).toHaveBeenCalled();
  });
});

describe('complaint-anchored handling', () => {
  /**
   * Regression: the handler read event.txHash but fabric-anchor-consumer publishes
   * fabricTxId, so anchored_tx_hash was silently written as NULL.
   */
  it('persists the Fabric transaction id from the fabricTxId field', async () => {
    const payload = {
      type: 'complaint-anchored',
      complaintId: 'complaint-9',
      merkleRoot: 'ab'.repeat(32),
      fabricTxId: 'tx-abc123-anchor-001',
      batchId: 'batch-77',
    };
    const m = { ...msg('500', null), topic: 'complaint-anchored', value: JSON.stringify(payload) } as any;

    await handleWithDedupe(m, 'complaint-anchored', 0, '500');

    const anchorUpdate = poolMock.query.mock.calls.find((c) =>
      String(c[0]).includes('anchored_tx_hash')
    );
    expect(anchorUpdate).toBeDefined();
    expect(anchorUpdate?.[1]?.[0]).toBe('tx-abc123-anchor-001');
  });
});
