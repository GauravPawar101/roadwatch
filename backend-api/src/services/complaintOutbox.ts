import { pool } from '@roadwatch/core';
import { emitComplaintEvent } from './kafka.js';

type DbLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type ComplaintSubmittedEnvelope = {
  type: 'complaint-submitted';
  idempotencyKey: string;
  occurredAt: string;
  version: number;
  complaintId: string;
  district: string;
  zone: string;
  lat?: number;
  lng?: number;
  description: string;
};

type OutboxRow = {
  id: string;
  topic: string;
  message_key: string;
  payload: ComplaintSubmittedEnvelope;
  attempts: number;
};

let relayTimer: ReturnType<typeof setInterval> | null = null;
let relayInFlight = false;

async function ensureOutboxTable(): Promise<void> {
  // DDL centralized in docker/postgres/init.sql; runtime table creation removed.
  console.info('Skipping creation of complaint_event_outbox; ensure docker/postgres/init.sql has been applied');
}

export async function enqueueComplaintSubmittedEvent(
  client: DbLike,
  event: ComplaintSubmittedEnvelope,
  topic = 'complaint-submitted'
): Promise<void> {
  await client.query(
    `INSERT INTO complaint_event_outbox
       (id, topic, message_key, payload, status, attempts, available_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())`,
    [topic, event.complaintId, JSON.stringify(event)]
  );
}

async function claimPendingEvents(limit: number): Promise<OutboxRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `WITH claimed AS (
         SELECT id
         FROM complaint_event_outbox
         WHERE status IN ('PENDING', 'FAILED')
           AND available_at <= NOW()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE complaint_event_outbox outbox
       SET status = 'IN_FLIGHT',
           attempts = attempts + 1,
           updated_at = NOW()
       FROM claimed
       WHERE outbox.id = claimed.id
       RETURNING outbox.id, outbox.topic, outbox.message_key, outbox.payload, outbox.attempts`,
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
    `UPDATE complaint_event_outbox
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
    `UPDATE complaint_event_outbox
     SET status = 'FAILED',
         attempts = $2,
         last_error = $3,
         available_at = NOW() + make_interval(secs => $4),
         updated_at = NOW()
     WHERE id = $1`,
    [id, attempts, error, delaySeconds]
  );
}

export async function drainComplaintEventOutbox(batchSize = 25): Promise<number> {
  const rows = await claimPendingEvents(batchSize);
  if (rows.length === 0) return 0;

  let processed = 0;
  for (const row of rows) {
    try {
      await emitComplaintEvent(row.payload, row.topic, { key: row.message_key });
      await markSent(row.id);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markFailed(row.id, row.attempts, message);
    }
  }

  return processed;
}

export async function startComplaintEventRelay(): Promise<() => Promise<void>> {
  await ensureOutboxTable();

  const tick = async () => {
    if (relayInFlight) return;
    relayInFlight = true;
    try {
      await drainComplaintEventOutbox(25);
    } catch (error) {
      console.error('[complaint-outbox] relay tick failed:', error instanceof Error ? error.message : String(error));
    } finally {
      relayInFlight = false;
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