import 'dotenv/config';

import { Kafka } from 'kafkajs';
import pg from 'pg';
import { registerServiceWithGateway } from '../../apps/gateway-api/src/services/discovery.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:6432/roadwatch',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[postgres] Unexpected error on idle client:', err instanceof Error ? err.message : String(err));
});


interface Config {
  kafkaBrokers: string[];
  kafkaGroupId: string;
  kafkaConsumerTimeout: number;
  serviceName: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function getConfig(): Config {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:29092').split(',');
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
  logLevel: 1 // Info level
});

const consumer = kafka.consumer({ groupId: config.kafkaGroupId });

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
 * Handle complaint.submitted events
 * Triggered when a citizen submits a new complaint
 */
async function handleComplaintSubmitted(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing complaint.submitted:', event.complaintId);

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
      ['complaint.submitted', event.complaintId, 'complaint', JSON.stringify(event)]
    );

    console.log('[webhook] ✓ Processed complaint.submitted:', event.complaintId);
  } catch (error) {
    console.error('[webhook] Error handling complaint.submitted:', error);
  }
}

/**
 * Handle complaint.anchored events
 * Triggered when complaint is anchored to Fabric blockchain
 */
async function handleComplaintAnchored(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing complaint.anchored:', event.complaintId);

    // Update complaint with anchoring details
    await pool.query(
      `UPDATE complaints 
       SET anchored_at = NOW(), anchored_tx_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [event.txHash, event.complaintId]
    );

    // Send notification to authorities
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        'ALL_AUTHORITIES',
        'complaint_anchored',
        'Complaint Anchored to Blockchain',
        `Complaint #${event.complaintId} has been anchored to blockchain`,
        JSON.stringify({ complaintId: event.complaintId, txHash: event.txHash })
      ]
    );

    console.log('[webhook] ✓ Processed complaint.anchored:', event.complaintId, 'TX:', event.txHash);
  } catch (error) {
    console.error('[webhook] Error handling complaint.anchored:', error);
  }
}

/**
 * Handle complaint.status.changed events
 * Triggered when complaint status changes
 */
async function handleComplaintStatusChanged(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing complaint.status.changed:', event.complaintId, 'to', event.newStatus);

    // Update complaint status
    await pool.query(
      `UPDATE complaints 
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [event.newStatus, event.complaintId]
    );

    // Notify relevant users based on status
    const roleMap: Record<string, string> = {
      submitted: 'contractor',
      assigned: 'contractor',
      in_progress: 'contractor',
      resolved: 'citizen',
      rejected: 'citizen'
    };

    const notifyRole = roleMap[event.newStatus] || 'authority';

    // Create notification for the appropriate role
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        notifyRole,
        'complaint_status_changed',
        'Complaint Status Updated',
        `Complaint #${event.complaintId} status is now: ${event.newStatus}`,
        JSON.stringify({ complaintId: event.complaintId, status: event.newStatus })
      ]
    );

    console.log('[webhook] ✓ Processed complaint.status.changed:', event.complaintId);
  } catch (error) {
    console.error('[webhook] Error handling complaint.status.changed:', error);
  }
}

/**
 * Handle notification.send events
 * Triggered when notifications need to be sent
 */
async function handleNotificationSend(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing notification.send:', event.notificationId);

    // Log notification delivery
    await pool.query(
      `INSERT INTO notification_delivery_logs (notification_id, channel, status, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [event.notificationId || 'unknown', event.channel || 'push', 'sent']
    );

    console.log('[webhook] ✓ Processed notification.send:', event.notificationId);
  } catch (error) {
    console.error('[webhook] Error handling notification.send:', error);
  }
}

/**
 * Handle authority.action events
 * Triggered when authority takes actions (verification, approval, rejection)
 */
async function handleAuthorityAction(message: KafkaMessage): Promise<void> {
  try {
    const event = JSON.parse(message.value || '{}');
    console.log('[webhook] Processing authority.action:', event.actionType, 'on', event.complaintId);

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

    // Notify citizen about the action
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

    console.log('[webhook] ✓ Processed authority.action:', event.actionType);
  } catch (error) {
    console.error('[webhook] Error handling authority.action:', error);
  }
}

/**
 * Route message to appropriate handler based on topic
 */
async function processMessage(message: KafkaMessage): Promise<void> {
  try {
    switch (message.topic) {
      case 'complaint.submitted':
        await handleComplaintSubmitted(message);
        break;
      case 'complaint.anchored':
        await handleComplaintAnchored(message);
        break;
      case 'complaint.status.changed':
        await handleComplaintStatusChanged(message);
        break;
      case 'notification.send':
        await handleNotificationSend(message);
        break;
      case 'authority.action':
        await handleAuthorityAction(message);
        break;
      default:
        console.log('[webhook] Unhandled topic:', message.topic);
    }
  } catch (error) {
    console.error('[webhook] Error processing message:', error);
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
      'complaint.submitted',
      'complaint.anchored',
      'complaint.status.changed',
      'notification.send',
      'authority.action'
    ];

    await consumer.subscribe({ topics, fromBeginning: false });
    console.log(`[${config.serviceName}] Subscribed to topics:`, topics.join(', '));

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
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

        await processMessage(kafkaMessage);
      }
    });

    console.log(`[${config.serviceName}] Webhook handler initialized and running...`);
    void registerServiceWithGateway({
      gatewayUrl: process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100',
      service: {
        name: config.serviceName,
        address: process.env.SERVICE_URL ?? `service://${config.serviceName}`,
        description: 'RoadWatch Kafka webhook handler'
      },
      registrySecret: process.env.SERVICE_REGISTRY_SECRET
    }).catch(error => {
      console.warn(`[${config.serviceName}] service registration failed:`, error instanceof Error ? error.message : String(error));
    });
  } catch (error) {
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