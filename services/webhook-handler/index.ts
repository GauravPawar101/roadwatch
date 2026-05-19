import 'dotenv/config';

import { Kafka } from 'kafkajs';
import { client, cassandraTypes as types } from '../../apps/gateway-api/src/cassandra.js';

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
// Uses shared Cassandra client from apps/gateway-api/src/cassandra.js
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

    // Read existing metadata and set event_status
    const sel = await client.execute('SELECT metadata FROM complaints WHERE id = ?', [event.complaintId], { prepare: true });
    let metadataObj: any = {};
    if (sel.rowLength && sel.rows[0].metadata) {
      try {
        metadataObj = JSON.parse(sel.rows[0].metadata);
      } catch {}
    }
    metadataObj.event_status = 'submitted_to_fabric';
    await client.execute('UPDATE complaints SET metadata = ?, updated_at = ? WHERE id = ?', [JSON.stringify(metadataObj), new Date(), event.complaintId], { prepare: true });

    // Log event (append-only)
    await client.execute(
      'INSERT INTO event_logs (id, event_type, entity_id, entity_type, event_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [types.TimeUuid.now(), 'complaint.submitted', event.complaintId, 'complaint', JSON.stringify(event), new Date()],
      { prepare: true }
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

    // Update complaint with anchoring details (simple set)
    const sel = await client.execute('SELECT metadata FROM complaints WHERE id = ?', [event.complaintId], { prepare: true });
    let metadataObj: any = {};
    if (sel.rowLength && sel.rows[0].metadata) {
      try { metadataObj = JSON.parse(sel.rows[0].metadata); } catch {}
    }
    metadataObj.blockchain_hash = event.txHash;
    // Do NOT overwrite logical complaint status with an anchoring marker.
    // Store anchor details separately so status remains meaningful (FILED/IN_PROGRESS/RESOLVED/etc.).
    await client.execute('UPDATE complaints SET anchored_at = ?, anchored_tx_hash = ?, metadata = ?, updated_at = ? WHERE id = ?', [new Date(), event.txHash, JSON.stringify(metadataObj), new Date(), event.complaintId], { prepare: true });

    // Send notification to authority
    // For PoC: create simple notifications for authorities (this avoids JOINs). In a full migration we'll maintain denormalized tables for recipients.
    await client.execute(
      'INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [types.TimeUuid.now(), 'ALL_AUTHORITIES', 'complaint_anchored', 'Complaint Anchored to Blockchain', `Complaint #${event.complaintId} has been anchored to blockchain`, JSON.stringify({ complaintId: event.complaintId, txHash: event.txHash }), new Date()],
      { prepare: true }
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
    const sel = await client.execute('SELECT metadata FROM complaints WHERE id = ?', [event.complaintId], { prepare: true });
    let metadataObj: any = {};
    if (sel.rowLength && sel.rows[0].metadata) {
      try { metadataObj = JSON.parse(sel.rows[0].metadata); } catch {}
    }
    metadataObj.last_status = event.previousStatus;
    await client.execute('UPDATE complaints SET status = ?, updated_at = ?, metadata = ? WHERE id = ?', [event.newStatus, new Date(), JSON.stringify(metadataObj), event.complaintId], { prepare: true });

    // Notify relevant users
    const roleMap: Record<string, string> = {
      submitted: 'contractor',
      assigned: 'contractor',
      in_progress: 'contractor',
      resolved: 'citizen',
      rejected: 'citizen'
    };

    const notifyRole = roleMap[event.newStatus] || 'authority';

    // PoC notification - denormalized recipient
    await client.execute('INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [types.TimeUuid.now(), notifyRole, 'complaint_status_changed', 'Complaint Status Updated', `Complaint #${event.complaintId} status is now: ${event.newStatus}`, JSON.stringify({ complaintId: event.complaintId, status: event.newStatus }), new Date()], { prepare: true });

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

    // Update notification delivery status - PoC: write delivery log
    await client.execute('INSERT INTO notification_delivery_logs (id, notification_id, channel, status, created_at) VALUES (?, ?, ?, ?, ?)', [types.TimeUuid.now(), event.notificationId || 'unknown', event.channel || 'push', 'sent', new Date()], { prepare: true });

    // Log delivery
    // (already logged above)

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
    await client.execute('INSERT INTO authority_action_logs (id, complaint_id, authority_id, action_type, action_data, created_at) VALUES (?, ?, ?, ?, ?, ?)', [types.TimeUuid.now(), event.complaintId, event.authorityId, event.actionType, JSON.stringify(event), new Date()], { prepare: true });

    // Update complaint metadata: select → merge → update
    const sel = await client.execute(
      'SELECT metadata FROM complaints WHERE id = ?',
      [event.complaintId],
      { prepare: true }
    );
    let metadataObj: any = {};
    if (sel.rowLength && sel.rows[0].metadata) {
      try { metadataObj = JSON.parse(sel.rows[0].metadata); } catch {}
    }
    metadataObj.last_authority_action = event.actionType;
    await client.execute(
      'UPDATE complaints SET metadata = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(metadataObj), new Date(), event.complaintId],
      { prepare: true }
    );

    // Notify citizen about action — PoC: look up user_id from complaint then insert notification
    const complaintRow = await client.execute(
      'SELECT user_id FROM complaints WHERE id = ?',
      [event.complaintId],
      { prepare: true }
    );
    const citizenId: string = complaintRow.rowLength ? complaintRow.rows[0].user_id ?? 'unknown' : 'unknown';
    await client.execute(
      'INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        types.TimeUuid.now(),
        citizenId,
        'authority_action',
        'Authority Action on Your Complaint',
        `Authority action: ${event.actionType} on complaint #${event.complaintId}`,
        JSON.stringify({ complaintId: event.complaintId, actionType: event.actionType }),
        new Date()
      ],
      { prepare: true }
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
    // Test Cassandra connection
    await client.connect();
    const ver = await client.execute('SELECT release_version FROM system.local');
    console.log(`[${config.serviceName}] Cassandra connected. version:`, ver.rows[0]?.release_version);
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
  } catch (error) {
    console.error(`[${config.serviceName}] Failed to initialize Kafka:`, error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log(`[${config.serviceName}] Received SIGTERM, shutting down gracefully...`);
    await consumer.disconnect();
    await client.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log(`[${config.serviceName}] Received SIGINT, shutting down gracefully...`);
    await consumer.disconnect();
    await client.shutdown();
    process.exit(0);
  });
}

// Start the webhook handler
initializeWebhookHandler().catch(error => {
  console.error('[webhook-handler] Failed to initialize:', error);
  process.exit(1);
});
