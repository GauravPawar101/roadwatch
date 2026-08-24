import 'dotenv/config';

import axios from 'axios';
import crypto from 'crypto';
import { Kafka } from 'kafkajs';
import pg from 'pg';
import { claimIdempotencyKey } from '@roadwatch/redis';

type NotificationSendEvent = {
  idempotencyKey: string;
  channels: Array<'sms' | 'push' | 'email'>;
  template: string;
  to: { phone?: string; deviceToken?: string; email?: string };
  params: Record<string, string>;
  priority?: 'low' | 'normal' | 'high';
};

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:16432/roadwatch',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const transientKafkaErrorPatterns = [
  /There is no leader for this topic-partition as we are in the middle of a leadership election/i,
  /The group coordinator is not available/i,
  /Response GroupCoordinator\(key: 10, version: 2\).*localhost:9094/i
];

pool.on('error', (err) => {
  console.error('[postgres] Unexpected error on idle client:', err instanceof Error ? err.message : String(err));
});

// DDL centralized in docker/postgres/init.sql; skip creating notification_inbox at runtime.
async function ensureNotificationInbox(): Promise<void> {
  console.info('Skipping runtime creation of notification_inbox; ensure docker/postgres/init.sql has been applied');
}

// Trigger a lightweight check at startup (best-effort)
ensureNotificationInbox().catch((e) => console.warn('[webhook] ensureNotificationInbox failed:', e instanceof Error ? e.message : String(e)));


interface Config {
  kafkaBrokers: string[];
  kafkaGroupId: string;
  kafkaConsumerTimeout: number;
  serviceName: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function getConfig(): Config {
  const brokers = (process.env.KAFKA_EVENTS_BROKERS || process.env.KAFKA_BROKERS || '127.0.0.1:9095').split(',');
  return {
    kafkaBrokers: brokers,
    kafkaGroupId: process.env.KAFKA_GROUP_ID || 'webhook-handler',
    kafkaConsumerTimeout: parseInt(process.env.KAFKA_CONSUMER_TIMEOUT || '3000'),
    serviceName: process.env.SERVICE_NAME || 'webhook-handler',
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info'
  };
}

const config = getConfig();
// Uses shared PostgreSQL pool from apps/gateway-api/src/postgres.js
const kafka = new Kafka({
  clientId: 'roadwatch-webhook-handler',
  brokers: config.kafkaBrokers,
  logLevel: 1, // Info level
  logCreator: () => ({ namespace, level, label, log }: any) => {
    const messageParts = [log?.message, log?.error?.message, log?.error?.stack, log?.broker, log?.groupId]
      .filter((part) => typeof part === 'string' && part.trim().length > 0);
    const message = messageParts.join(' ');

    if (level === 1 && transientKafkaErrorPatterns.some((pattern: RegExp) => pattern.test(message))) {
      return;
    }

    const output = `[kafkajs]${namespace ? ` ${namespace}` : ''}${label ? ` ${label}` : ''}${message ? ` ${message}` : ''}`;

    switch (level) {
      case 1:
        console.error(output);
        break;
      case 2:
        console.warn(output);
        break;
      default:
        console.info(output);
        break;
    }
  }
});

const consumer = kafka.consumer({
  groupId: config.kafkaGroupId,
  maxInFlightRequests: Math.max(1, Number.parseInt(process.env.WEBHOOK_MAX_IN_FLIGHT ?? '8', 10) || 8)
});

const dlqProducer = kafka.producer();
let dlqConnected = false;
const handlerAttempts = new Map<string, number>();
const WEBHOOK_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '3', 10) || 3);

async function ensureDlqProducer(): Promise<void> {
  if (dlqConnected) return;
  await dlqProducer.connect();
  dlqConnected = true;
}

async function publishWebhookDlq(message: KafkaMessage, error: string, attempts: number): Promise<void> {
  try {
    await ensureDlqProducer();
    const payload = {
      type: 'dlq-events',
      idempotencyKey: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      version: 1,
      originalTopic: message.topic,
      consumerId: config.serviceName,
      attempts,
      error,
      rawMessage: {
        topic: message.topic,
        partition: message.partition,
        offset: message.offset,
        key: message.key,
        value: message.value,
        headers: message.headers
      }
    };
    await dlqProducer.send({
      topic: 'dlq-events',
      messages: [{ key: message.key ?? undefined, value: JSON.stringify(payload) }]
    });
  } catch (dlqError) {
    console.error('[webhook] failed to publish DLQ:', dlqError instanceof Error ? dlqError.message : String(dlqError));
  }
}

const processConcurrency = Math.max(1, Number.parseInt(process.env.WEBHOOK_CONCURRENCY ?? '4', 10) || 4);
let inFlight = 0;

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= processConcurrency) {
    await new Promise(r => setTimeout(r, 10));
  }
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
  }
}

async function sendInternalNotification(payload: Record<string, unknown>): Promise<boolean> {
  const gatewayUrl = process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100';
  const token = process.env.INTERNAL_SERVICE_TOKEN || process.env.SERVICE_TOKEN || '';

  if (!token) return false;

  try {
    const response = await axios.post(`${gatewayUrl}/internal/notifications/create`, payload, {
      headers: {
        'content-type': 'application/json',
        'x-service-token': token
      },
      validateStatus: () => true,
      timeout: 5000
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

interface KafkaMessage {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

/**
 * Handle complaint-submitted events
 * Triggered when a citizen submits a new complaint
 */
async function handleComplaintSubmitted(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing complaint-submitted:', event.complaintId);

    // Update complaint with event status
    await pool.query(
      `UPDATE complaints 
       SET event_status = $1, updated_at = NOW()
       WHERE id = $2`,
      ['submitted_to_fabric', event.complaintId]
    );

    // Log event (append-only)
    await pool.query(
      `INSERT INTO event_logs (event_type, entity_id, entity_type, event_data, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      ['complaint-submitted', event.complaintId, 'complaint', JSON.stringify(event)]
    );

    console.log('[webhook] Processed complaint-submitted:', event.complaintId);
  } catch (error) {
    console.error('[webhook] Error handling complaint-submitted:', error);
    throw error;
  }
}

/**
 * Handle complaint-anchored events
 * Triggered when complaint is anchored to Fabric blockchain
 */
async function handleComplaintAnchored(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing complaint-anchored:', event.complaintId);

    // Update complaint with anchoring details
    await pool.query(
      `UPDATE complaints 
       SET anchored_at = NOW(), anchored_tx_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [event.txHash, event.complaintId]
    );

    // Send notification through gateway; fall back to local inserts if the gateway is unavailable.
    const handledByGateway = await sendInternalNotification({
      recipient_role: 'ALL_AUTHORITIES',
      type: 'complaint_anchored',
      title: 'Complaint Anchored to Blockchain',
      body: `Complaint #${event.complaintId} has been anchored to blockchain`,
      data: { complaintId: event.complaintId, txHash: event.txHash }
    });

    if (!handledByGateway) {
      const insertRes = await pool.query(
        `INSERT INTO notifications (recipient_role, type, title, body, data, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
        [
          'ALL_AUTHORITIES',
          'complaint_anchored',
          'Complaint Anchored to Blockchain',
          `Complaint #${event.complaintId} has been anchored to blockchain`,
          JSON.stringify({ complaintId: event.complaintId, txHash: event.txHash })
        ]
      );

      const notificationId = insertRes.rows[0]?.id;
      if (notificationId) {
        const roles = ['CE', 'EE'];
        const users = await pool.query(`SELECT id FROM users WHERE role = ANY($1)`, [roles]);
        for (const u of users.rows) {
          const inboxId = crypto.randomUUID();
          await pool.query(`INSERT INTO notification_inbox (id, user_id, notification_id, created_at) VALUES ($1,$2,$3,NOW())`, [inboxId, u.id, notificationId]);
          await pool.query(`INSERT INTO notification_deliveries (id, user_id, notification_id, channel, created_at) VALUES ($1,$2,$3,$4,NOW())`, [crypto.randomUUID(), u.id, notificationId, 'IN_APP']);
        }
      }
    }

    console.log('[webhook] Processed complaint-anchored:', event.complaintId, 'TX:', event.txHash);
  } catch (error) {
    console.error('[webhook] Error handling complaint-anchored:', error);
    throw error;
  }
}

/**
 * Handle complaint-status-changed events
 * Triggered when complaint status changes
 */
async function handleComplaintStatusChanged(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    // ComplaintStatusChangedEvent uses `toStatus`, not `newStatus`
    const newStatus: string | undefined = event.toStatus ?? event.newStatus;
    console.log('[webhook] Processing complaint-status-changed:', event.complaintId, 'to', newStatus);

    if (newStatus) {
      await pool.query(
        `UPDATE complaints 
         SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [newStatus, event.complaintId]
      );
    }

    // Notify relevant users based on status
    const roleMap: Record<string, string> = {
      submitted: 'contractor',
      assigned: 'contractor',
      in_progress: 'contractor',
      resolved: 'citizen',
      rejected: 'citizen'
    };

    const notifyRole = roleMap[(newStatus ?? '').toLowerCase()] || 'authority';

    // Fan out through the gateway first. If the gateway is unavailable, fall back locally.
    const roleIsUuid = typeof notifyRole === 'string' && /^[0-9a-fA-F-]{36}$/.test(notifyRole);
    const handledByGateway = roleIsUuid
      ? await sendInternalNotification({
          message: {
            type: 'complaint_status_changed',
            title: 'Complaint Status Updated',
            body: `Complaint #${event.complaintId} status is now: ${newStatus}`,
            audience: { kind: 'user', userId: notifyRole },
            data: { complaintId: event.complaintId, status: newStatus }
          }
        })
      : await sendInternalNotification({
          recipient_role: notifyRole,
          type: 'complaint_status_changed',
          title: 'Complaint Status Updated',
          body: `Complaint #${event.complaintId} status is now: ${newStatus}`,
          data: { complaintId: event.complaintId, status: newStatus }
        });

    if (!handledByGateway) {
      if (roleIsUuid) {
        const insertRes2 = await pool.query(
          `INSERT INTO notifications (user_id, type, title, body, data, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
          [
            notifyRole,
            'complaint_status_changed',
            'Complaint Status Updated',
            `Complaint #${event.complaintId} status is now: ${newStatus}`,
            JSON.stringify({ complaintId: event.complaintId, status: newStatus })
          ]
        );
        const nid = insertRes2.rows[0]?.id;
        if (nid) {
          await pool.query(`INSERT INTO notification_inbox (id, user_id, notification_id, created_at) VALUES ($1,$2,$3,NOW())`, [crypto.randomUUID(), notifyRole, nid]);
          await pool.query(`INSERT INTO notification_deliveries (id, user_id, notification_id, channel, created_at) VALUES ($1,$2,$3,$4,NOW())`, [crypto.randomUUID(), notifyRole, nid, 'IN_APP']);
        }
      } else {
        const insertRes3 = await pool.query(
          `INSERT INTO notifications (recipient_role, type, title, body, data, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
          [
            notifyRole,
            'complaint_status_changed',
            'Complaint Status Updated',
            `Complaint #${event.complaintId} status is now: ${newStatus}`,
            JSON.stringify({ complaintId: event.complaintId, status: newStatus })
          ]
        );
        const nid = insertRes3.rows[0]?.id;
        if (nid) {
          const roleMapLookup: Record<string, string[]> = {
            authority: ['CE','EE'],
            contractor: ['CONTRACTOR'],
            citizen: ['CITIZEN']
          };
          const targetRoles = roleMapLookup[notifyRole] || ['CE','EE'];
          const users = await pool.query(`SELECT id FROM users WHERE role = ANY($1)`, [targetRoles]);
          for (const u of users.rows) {
            await pool.query(`INSERT INTO notification_inbox (id, user_id, notification_id, created_at) VALUES ($1,$2,$3,NOW())`, [crypto.randomUUID(), u.id, nid]);
            await pool.query(`INSERT INTO notification_deliveries (id, user_id, notification_id, channel, created_at) VALUES ($1,$2,$3,$4,NOW())`, [crypto.randomUUID(), u.id, nid, 'IN_APP']);
          }
        }
      }
    }

    console.log('[webhook] Processed complaint-status-changed:', event.complaintId);
  } catch (error) {
    console.error('[webhook] Error handling complaint-status-changed:', error);
    throw error;
  }
}

/**
 * Handle notification-send events
 * Triggered when notifications need to be sent
 */
async function handleNotificationSend(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}') as NotificationSendEvent;
    const primaryChannel = event.channels[0] ?? 'push';
    const notificationKey = event.idempotencyKey || event.template;
    console.log('[webhook] Processing notification-send:', event.template, 'channels:', event.channels.join(','));

    // Log notification delivery
    await pool.query(
      `INSERT INTO notification_delivery_logs (notification_id, channel, status, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [notificationKey, primaryChannel, 'sent']
    );

    console.log('[webhook] Processed notification-send:', event.template);
  } catch (error) {
    console.error('[webhook] Error handling notification-send:', error);
    throw error;
  }
}

/**
 * Handle authority-action events
 * Triggered when authority takes actions (verification, approval, rejection)
 */
async function handleAuthorityAction(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing authority-action:', event.actionType, 'on', event.complaintId);

    // Log the authority action
    await pool.query(
      `INSERT INTO authority_action_logs (complaint_id, authority_id, action_type, action_data, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [event.complaintId, event.authorityId, event.actionType, JSON.stringify(event)]
    );

    // Update complaint with last action
    await pool.query(
      `UPDATE complaints 
       SET last_authority_action = $1, updated_at = NOW()
       WHERE id = $2`,
      [event.actionType, event.complaintId]
    );

    // Get the citizen ID for this complaint
    const result = await pool.query(
      'SELECT user_id FROM complaints WHERE id = $1',
      [event.complaintId]
    );

    const citizenId = result.rows.length > 0 ? result.rows[0].user_id : 'unknown';

    // Notify citizen via gateway first; fallback to local insert if needed.
    const handledByGateway = await sendInternalNotification({
      message: {
        type: 'authority_action',
        title: 'Authority Action on Your Complaint',
        body: `Authority action: ${event.actionType} on complaint #${event.complaintId}`,
        audience: { kind: 'user', userId: citizenId },
        data: { complaintId: event.complaintId, actionType: event.actionType }
      }
    });

    if (!handledByGateway) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, data, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          citizenId,
          'authority_action',
          'Authority Action on Your Complaint',
          `Authority action: ${event.actionType} on complaint #${event.complaintId}`,
          JSON.stringify({ complaintId: event.complaintId, actionType: event.actionType })
        ]
      );
    }

    console.log('[webhook] Processed authority-action:', event.actionType);
  } catch (error) {
    console.error('[webhook] Error handling authority-action:', error);
    throw error;
  }
}

/**
 * Route message to appropriate handler based on topic.
 * On repeated failure, publish to dlq-events (sound dead-letter path).
 */
async function processMessage(message: KafkaMessage): Promise<void> {
  const attemptKey = `${message.topic}:${message.partition}:${message.offset}`;
  try {
    switch (message.topic) {
      case 'complaint-submitted':
        await handleComplaintSubmitted(message);
        break;
      case 'complaint-anchored':
        await handleComplaintAnchored(message);
        break;
      case 'complaint-status-changed':
        await handleComplaintStatusChanged(message);
        break;
      case 'notification-send':
        await handleNotificationSend(message);
        break;
      case 'authority-action':
        await handleAuthorityAction(message);
        break;
      default:
        console.log('[webhook] Unhandled topic:', message.topic);
    }
    handlerAttempts.delete(attemptKey);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[webhook] Error processing message:', errMsg);
    const attempts = (handlerAttempts.get(attemptKey) ?? 0) + 1;
    handlerAttempts.set(attemptKey, attempts);
    if (attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await publishWebhookDlq(message, errMsg, attempts);
      handlerAttempts.delete(attemptKey);
    } else {
      // Re-throw so kafkajs does not commit; message will be retried.
      throw error;
    }
  }
}

/**
 * Initialize webhook handler
 */
async function initializeWebhookHandler(): Promise<void> {
  console.log(`[${config.serviceName}] Starting webhook handler...`);

  try {
    // Test PostgreSQL connection
    const result = await pool.query('SELECT version()');
    console.log(`[${config.serviceName}] PostgreSQL connected. version:`, result.rows[0]?.version);
  } catch (error) {
    console.error(`[${config.serviceName}] Failed to connect to database:`, error);
    process.exit(1);
  }

  try {
    // Connect to Kafka
    await consumer.connect();
    console.log(`[${config.serviceName}] Connected to Kafka brokers:`, config.kafkaBrokers);

    // Subscribe to topics
    const topics = [
      'complaint-submitted',
      'complaint-anchored',
      'complaint-status-changed',
      'notification-send',
      'authority-action'
    ];

    await consumer.subscribe({ topics, fromBeginning: false });
    console.log(`[${config.serviceName}] Subscribed to topics:`, topics.join(', '));

    // Start consuming messages
    await consumer.run({
      partitionsConsumedConcurrently: Math.max(1, Number.parseInt(process.env.WEBHOOK_PARTITIONS_CONCURRENT ?? '2', 10) || 2),
      eachMessage: async ({ topic, partition, message }) => {
        await withConcurrencyLimit(async () => {
          const kafkaMessage: KafkaMessage = {
            topic,
            partition,
            offset: message.offset,
            timestamp: message.timestamp || '',
            key: message.key ? message.key.toString() : null,
            value: message.value ? message.value.toString() : null,
            headers: {}
          };

          if (message.headers) {
            for (const [key, value] of Object.entries(message.headers)) {
              kafkaMessage.headers[key] = value ? value.toString() : '';
            }
          }

          const dedupeKey = kafkaMessage.key || `${topic}:${partition}:${message.offset}`;
          try {
            const claim = await claimIdempotencyKey(`roadwatch:webhook:idempotency:${dedupeKey}`, 86_400);
            if (claim.ok && !claim.claimed) {
              return;
            }
          } catch {
            // fail-open on redis
          }

          await processMessage(kafkaMessage);
        });
      }
    });

    console.log(`[${config.serviceName}] Webhook handler initialized and running...`);
  } catch (error: unknown) {
    console.error(`[${config.serviceName}] Failed to initialize Kafka:`, error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log(`[${config.serviceName}] Received SIGTERM, shutting down gracefully...`);
    await consumer.disconnect();
    await pool.end();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log(`[${config.serviceName}] Received SIGINT, shutting down gracefully...`);
    await consumer.disconnect();
    await pool.end();
    process.exit(0);
  });
}

// Start the webhook handler
initializeWebhookHandler().catch(error => {
  console.error('[webhook-handler] Failed to initialize:', error);
  process.exit(1);
});