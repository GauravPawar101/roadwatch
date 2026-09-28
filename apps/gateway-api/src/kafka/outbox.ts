import { setOutboxDepthGauge } from '@roadwatch/redis';
import { OUTBOX_MAX_ATTEMPTS_BEFORE_DEAD, KafkaTopics } from '@roadwatch/kafka';
import { pool } from '../postgres.js';
import { getKafkaProducer } from './producer.js';

type DbLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type KafkaOutboxOptions = {
  key?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
};

type OutboxRow = {
  id: string;
  topic: string;
  message_key: string | null;
  headers: Record<string, string> | null;
  payload: unknown;
  attempts: number;
};

let relayTimer: ReturnType<typeof setInterval> | null = null;
let relayRunning = false;

async function ensureOutboxTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS kafka_event_outbox (
       id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       topic           text        NOT NULL,
       message_key     text,
       headers         jsonb,
       payload         jsonb       NOT NULL,
       idempotency_key text,
       status          text        NOT NULL DEFAULT 'PENDING',
       attempts        integer     NOT NULL DEFAULT 0,
       available_at    timestamptz NOT NULL DEFAULT NOW(),
       sent_at         timestamptz,
       last_error      text,
       created_at      timestamptz NOT NULL DEFAULT NOW(),
       updated_at      timestamptz NOT NULL DEFAULT NOW()
     )`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS kafka_event_outbox_status_available_idx
       ON kafka_event_outbox (status, available_at, created_at)`
  );
}

export async function enqueueKafkaEvent(
  client: DbLike,
  topic: string,
  payload: unknown,
  options: KafkaOutboxOptions = {}
): Promise<void> {
  await client.query(
    `INSERT INTO kafka_event_outbox
       (id, topic, message_key, headers, payload, idempotency_key, status, attempts, available_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5, 'PENDING', 0, NOW(), NOW(), NOW())`,
    [
      topic,
      options.key ?? null,
      options.headers ? JSON.stringify(options.headers) : null,
      JSON.stringify(payload),
      options.idempotencyKey ?? null
    ]
  );
}

async function claimPendingEvents(limit: number): Promise<OutboxRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `WITH claimed AS (
         SELECT id
         FROM kafka_event_outbox
         WHERE status IN ('PENDING', 'FAILED')
           AND available_at <= NOW()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE kafka_event_outbox outbox
       SET status = 'IN_FLIGHT',
           attempts = attempts + 1,
           updated_at = NOW()
       FROM claimed
       WHERE outbox.id = claimed.id
       RETURNING outbox.id, outbox.topic, outbox.message_key, outbox.headers, outbox.payload, outbox.attempts`,
      [limit]
    );
    await client.query('COMMIT');
    return result.rows as OutboxRow[];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markSent(id: string): Promise<void> {
  await pool.query(
    `UPDATE kafka_event_outbox
     SET status = 'SENT',
         sent_at = NOW(),
         updated_at = NOW(),
         last_error = NULL
     WHERE id = $1`,
    [id]
  );
}

async function markFailed(id: string, attempts: number, error: string): Promise<void> {
  if (attempts >= OUTBOX_MAX_ATTEMPTS_BEFORE_DEAD) {
    await pool.query(
      `UPDATE kafka_event_outbox
       SET status = 'DEAD',
           attempts = $2,
           last_error = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [id, attempts, error]
    );
    return;
  }

  const delaySeconds = Math.min(60, Math.max(5, attempts * 5));
  await pool.query(
    `UPDATE kafka_event_outbox
     SET status = 'FAILED',
         attempts = $2,
         last_error = $3,
         available_at = NOW() + make_interval(secs => $4),
         updated_at = NOW()
     WHERE id = $1`,
    [id, attempts, error, delaySeconds]
  );
}

async function publishOutboxDeadLetter(row: OutboxRow, error: string): Promise<void> {
  try {
    const producer = getKafkaProducer();
    await producer.publish(KafkaTopics.dlq, {
      type: 'dlq-events',
      idempotencyKey: row.id,
      occurredAt: new Date().toISOString(),
      version: 1,
      originalTopic: row.topic,
      consumerId: 'gateway-kafka-outbox',
      attempts: row.attempts,
      error,
      rawMessage: {
        id: row.id,
        topic: row.topic,
        message_key: row.message_key,
        headers: row.headers,
        payload: row.payload
      }
    });
  } catch (dlqError) {
    console.error(
      '[gateway-kafka-outbox] failed to publish DLQ for',
      row.id,
      dlqError instanceof Error ? dlqError.message : String(dlqError)
    );
  }
}

export async function drainKafkaEventOutbox(batchSize = 25): Promise<number> {
  try {
    const depthRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM kafka_event_outbox WHERE status IN ('PENDING', 'FAILED', 'IN_FLIGHT')`
    );
    await setOutboxDepthGauge(Number.parseInt(depthRes.rows[0]?.count ?? '0', 10) || 0);
  } catch {
    // best-effort gauge
  }

  const rows = await claimPendingEvents(batchSize);
  if (rows.length === 0) return 0;

  const producer = getKafkaProducer();
  let sent = 0;

  for (const row of rows) {
    try {
      await producer.publish(row.topic, row.payload, {
        key: row.message_key ?? undefined,
        headers: row.headers ?? undefined
      });
      await markSent(row.id);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markFailed(row.id, row.attempts, message);
      if (row.attempts >= OUTBOX_MAX_ATTEMPTS_BEFORE_DEAD) {
        await publishOutboxDeadLetter(row, message);
      }
    }
  }

  return sent;
}

export async function startKafkaEventRelay(): Promise<() => Promise<void>> {
  await ensureOutboxTable();

  const batchSize = positiveInt(process.env.KAFKA_OUTBOX_BATCH_SIZE, 200);
  const intervalMs = positiveInt(process.env.KAFKA_OUTBOX_INTERVAL_MS, 1000);
  // Bounds how much work one tick may do, so draining a large backlog cannot
  // monopolise the event loop and stall request handling.
  const maxBatchesPerTick = positiveInt(process.env.KAFKA_OUTBOX_MAX_BATCHES_PER_TICK, 20);

  const tick = async () => {
    if (relayRunning) return;
    relayRunning = true;
    try {
      // Drain repeatedly until a batch comes back short.
      //
      // This previously drained a fixed 25 rows once per second, capping the
      // relay at 25 events/second. The write path produced ~54/second under
      // load, so the backlog grew without bound: 18,463 PENDING against 34,052
      // SENT after a single 3-minute run. The backlog is read as a pressure
      // signal by the admission limiter, so an undersized relay throttles the
      // primary write path — the async side starving the sync side.
      //
      // Looping only while a batch is full means a partial failure (some rows
      // failed to publish) stops the loop and backs off to the next tick
      // instead of spinning on a poison batch.
      for (let batch = 0; batch < maxBatchesPerTick; batch += 1) {
        const sent = await drainKafkaEventOutbox(batchSize);
        if (sent < batchSize) break;
      }
    } catch (error) {
      console.error('[gateway-kafka-outbox] relay tick failed:', error instanceof Error ? error.message : String(error));
    } finally {
      relayRunning = false;
    }
  };

  void tick();
  relayTimer = setInterval(() => {
    void tick();
  }, intervalMs);

  return async () => {
    if (relayTimer) {
      clearInterval(relayTimer);
      relayTimer = null;
    }
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}