import { getKafkaProducer } from './producer.js';
import { pool } from '../postgres.js';

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kafka_event_outbox (
      id UUID PRIMARY KEY,
      topic TEXT NOT NULL,
      message_key TEXT,
      headers JSONB,
      payload JSONB NOT NULL,
      idempotency_key TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      available_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_kafka_event_outbox_pending
    ON kafka_event_outbox (status, available_at, created_at)
  `);
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

export async function drainKafkaEventOutbox(batchSize = 25): Promise<number> {
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
    }
  }

  return sent;
}

export async function startKafkaEventRelay(): Promise<() => Promise<void>> {
  await ensureOutboxTable();

  const tick = async () => {
    if (relayRunning) return;
    relayRunning = true;
    try {
      await drainKafkaEventOutbox(25);
    } catch (error) {
      console.error('[gateway-kafka-outbox] relay tick failed:', error instanceof Error ? error.message : String(error));
    } finally {
      relayRunning = false;
    }
  };

  void tick();
  relayTimer = setInterval(() => {
    void tick();
  }, 1000);

  return async () => {
    if (relayTimer) {
      clearInterval(relayTimer);
      relayTimer = null;
    }
  };
}