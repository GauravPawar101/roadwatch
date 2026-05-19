import 'dotenv/config';

import * as grpc from '@grpc/grpc-js';
import { connect, signers, type Contract, type Gateway } from '@hyperledger/fabric-gateway';
import { Client as CassandraClient } from 'cassandra-driver';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { Kafka as KafkaJS } from 'kafkajs';

import { getLocalKafkaBrokers } from '../../providers/kafka/index.js';
import { KafkaProducer } from '../../providers/kafka/KafkaProducer.js';
import { KafkaTopics, type ComplaintSubmittedEvent, type DlqEvent, type NotificationSendEvent } from '../../providers/kafka/topics.js';

type DbClient = CassandraClient;

type Direction = 'left' | 'right';
type ProofStep = { direction: Direction; hash: string };

type Env = NodeJS.ProcessEnv;

type ConsumedMessage = {
  topic: string;
  partition?: number;
  offset?: string;
  key?: string | null;
  value: string;
  headers?: Record<string, string>;
};

type PollConsumer = {
  consume: (args: {
    consumerGroupId: string;
    instanceId: string;
    topics: string[];
    timeout: number;
    autoCommit: boolean;
    autoOffsetReset?: 'earliest' | 'latest';
  }) => Promise<ConsumedMessage[]>;
  commit: (args: { consumerGroupId: string; instanceId: string }) => Promise<void>;
  disconnect?: () => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class LocalKafkaPollConsumer implements PollConsumer {
  private readonly consumer: ReturnType<KafkaJS['consumer']>;
  private subscribed = false;
  private running = false;
  private runStarted = false;
  private readonly queue: ConsumedMessage[] = [];
  private pendingCommitOffsets = new Map<string, string>();

  constructor(private readonly brokers: string[], private readonly groupId: string, private readonly instanceId: string) {
    const kafka = new KafkaJS({ clientId: 'roadwatch-fabric-anchor-consumer', brokers });
    this.consumer = kafka.consumer({ groupId, allowAutoTopicCreation: true });
  }

  private async ensureRunning(fromBeginning: boolean, topics: string[]): Promise<void> {
    if (!this.running) {
      await this.consumer.connect();
      this.running = true;
    }

    if (!this.subscribed) {
      for (const topic of topics) {
        await this.consumer.subscribe({ topic, fromBeginning });
      }
      this.subscribed = true;
    }

    if (this.runStarted) return;
    this.runStarted = true;

    // Start the background fetch loop once.
    // Note: this will buffer messages even while we're processing; we commit explicitly.
    void this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const value = message.value ? message.value.toString('utf8') : '';
        const key = message.key ? message.key.toString('utf8') : null;
        const headers: Record<string, string> = {};
        if (message.headers) {
          for (const [hKey, hVal] of Object.entries(message.headers)) {
            if (hVal == null) continue;
            headers[hKey] = Buffer.isBuffer(hVal) ? hVal.toString('utf8') : String(hVal);
          }
        }

        this.queue.push({ topic, partition, offset: message.offset, key, value, headers });
      }
    });
  }

  async consume(args: {
    consumerGroupId: string;
    instanceId: string;
    topics: string[];
    timeout: number;
    autoCommit: boolean;
    autoOffsetReset?: 'earliest' | 'latest';
  }): Promise<ConsumedMessage[]> {
    if (args.consumerGroupId !== this.groupId) {
      throw new Error(`LocalKafkaPollConsumer groupId mismatch: expected ${this.groupId}, got ${args.consumerGroupId}`);
    }

    const fromBeginning = args.autoOffsetReset === 'earliest';
    await this.ensureRunning(fromBeginning, args.topics);

    const start = Date.now();
    while (this.queue.length === 0 && Date.now() - start < args.timeout) {
      await sleep(50);
    }

    const drained = this.queue.splice(0, this.queue.length);
    this.pendingCommitOffsets = new Map();
    for (const msg of drained) {
      if (msg.partition == null || msg.offset == null) continue;
      const key = `${msg.topic}:${msg.partition}`;
      const prev = this.pendingCommitOffsets.get(key);
      if (!prev || BigInt(msg.offset) > BigInt(prev)) {
        this.pendingCommitOffsets.set(key, msg.offset);
      }
    }

    return drained;
  }

  async commit(_args: { consumerGroupId: string; instanceId: string }): Promise<void> {
    if (this.pendingCommitOffsets.size === 0) return;

    const offsets = Array.from(this.pendingCommitOffsets.entries()).map(([key, offset]) => {
      const [topic, partitionStr] = key.split(':');
      const partition = Number(partitionStr);
      const nextOffset = (BigInt(offset) + 1n).toString();
      return { topic: topic!, partition, offset: nextOffset };
    });

    await this.consumer.commitOffsets(offsets);
    this.pendingCommitOffsets.clear();
  }

  async disconnect(): Promise<void> {
    if (!this.running) return;
    await this.consumer.disconnect();
    this.running = false;
  }
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys.map(key => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',');
  return `{${body}}`;
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function merkleRoot(leaves: string[]): { root: string; proofs: ProofStep[][] } {
  if (leaves.length === 0) {
    return { root: sha256Hex(''), proofs: [] };
  }

  const leafHashes = leaves.map(v => sha256Hex(v));
  const layers: string[][] = [leafHashes];

  while (layers.at(-1)!.length > 1) {
    const prev = layers.at(-1)!;
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i]!;
      const right = prev[i + 1] ?? prev[i]!;
      next.push(sha256Hex(left + right));
    }
    layers.push(next);
  }

  const root = layers.at(-1)![0]!;

  const proofs: ProofStep[][] = leafHashes.map((_, leafIndex) => {
    const proof: ProofStep[] = [];
    let index = leafIndex;
    for (let layerIndex = 0; layerIndex < layers.length - 1; ++layerIndex) {
      const layer = layers[layerIndex]!;
      const isRightNode = index % 2 === 1;
      const siblingIndex = isRightNode ? index - 1 : index + 1;
      const siblingHash = (layer[siblingIndex] ?? layer[index])!;
      proof.push({
        direction: isRightNode ? 'left' : 'right',
        hash: siblingHash
      });
      index = Math.floor(index / 2);
    }
    return proof;
  });

  return { root, proofs };
}

async function connectFabric(env: Env = process.env): Promise<{ gateway: Gateway; contract: Contract }> {
  const tlsCertPath = requireEnv(env.FABRIC_TLS_CERT_PATH, 'FABRIC_TLS_CERT_PATH');
  const peerEndpoint = requireEnv(env.FABRIC_PEER_ENDPOINT, 'FABRIC_PEER_ENDPOINT');
  const peerHostAlias = requireEnv(env.FABRIC_PEER_HOST_ALIAS, 'FABRIC_PEER_HOST_ALIAS');
  const channelName = requireEnv(env.FABRIC_CHANNEL_NAME, 'FABRIC_CHANNEL_NAME');
  const chaincodeName = requireEnv(env.FABRIC_CHAINCODE_NAME, 'FABRIC_CHAINCODE_NAME');
  const mspId = requireEnv(env.FABRIC_MSP_ID, 'FABRIC_MSP_ID');
  const x509CertPath = requireEnv(env.FABRIC_X509_CERT_PATH, 'FABRIC_X509_CERT_PATH');
  const x509KeyPath = requireEnv(env.FABRIC_X509_KEY_PATH, 'FABRIC_X509_KEY_PATH');

  const certificate = await fs.readFile(x509CertPath, 'utf8');
  const privateKeyPem = await fs.readFile(x509KeyPath, 'utf8');
  const tlsRootCertificate = await fs.readFile(tlsCertPath);

  const grpcCredentials = grpc.credentials.createSsl(tlsRootCertificate);
  const grpcClient = new grpc.Client(peerEndpoint, grpcCredentials, {
    'grpc.ssl_target_name_override': peerHostAlias
  });

  const gateway = connect({
    client: grpcClient,
    identity: { mspId, credentials: Uint8Array.from(Buffer.from(certificate)) },
    signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem)),
    evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
    submitOptions: () => ({ deadline: Date.now() + 5_000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60_000 })
  });

  const network = gateway.getNetwork(channelName);
  const contract = network.getContract(chaincodeName);
  return { gateway, contract };
}

async function connectCassandra(env: Env = process.env): Promise<DbClient> {
  const contactPoints = requireEnv(env.CASSANDRA_CONTACT_POINTS, 'CASSANDRA_CONTACT_POINTS').split(',');
  const keyspace = requireEnv(env.CASSANDRA_KEYSPACE, 'CASSANDRA_KEYSPACE');
  const localDataCenter = env.CASSANDRA_LOCAL_DC ?? 'datacenter1';

  const client = new CassandraClient({
    contactPoints,
    localDataCenter,
    keyspace,
    credentials: env.CASSANDRA_USERNAME && env.CASSANDRA_PASSWORD
      ? { username: env.CASSANDRA_USERNAME, password: env.CASSANDRA_PASSWORD }
      : undefined
  });

  await client.connect();
  return client;
}

async function ensureTables(db: DbClient): Promise<void> {
  // Create keyspace if needed (optional, may be pre-created)
  const keyspace = requireEnv(process.env.CASSANDRA_KEYSPACE, 'CASSANDRA_KEYSPACE');

  // Processed events table: track which idempotency keys have been processed
  // Partition key: (consumer_id, key) for efficient lookups per consumer
  await db.execute(`
    CREATE TABLE IF NOT EXISTS processed_events (
      consumer_id text,
      key text,
      processed_at timestamp,
      PRIMARY KEY (consumer_id, key)
    ) WITH CLUSTERING ORDER BY (key ASC)
      AND default_time_to_live = 2592000;
  `);

  // Event failures table: track retry count and last error
  // Partition key: (consumer_id, key) for efficient failure lookups
  await db.execute(`
    CREATE TABLE IF NOT EXISTS event_failures (
      consumer_id text,
      key text,
      failure_count int,
      last_error text,
      updated_at timestamp,
      PRIMARY KEY (consumer_id, key)
    ) WITH CLUSTERING ORDER BY (key ASC)
      AND default_time_to_live = 2592000;
  `);

  // Complaint merkle proofs table: denormalized for fast lookups
  // Primary partition: complaint_id for direct lookup
  // Clustering: anchored_at DESC for time-based queries
  await db.execute(`
    CREATE TABLE IF NOT EXISTS complaint_merkle_proofs (
      complaint_id text PRIMARY KEY,
      merkle_root text,
      merkle_proof text,
      fabric_txid text,
      batch_id text,
      anchored_at timestamp
    );
  `);

  // Secondary index on batch_id for batch-based queries
  await db.execute(`
    CREATE TABLE IF NOT EXISTS complaint_merkle_proofs_by_batch (
      batch_id text,
      complaint_id text,
      merkle_root text,
      merkle_proof text,
      fabric_txid text,
      anchored_at timestamp,
      PRIMARY KEY (batch_id, complaint_id)
    ) WITH CLUSTERING ORDER BY (complaint_id ASC);
  `);
}

async function isProcessed(db: DbClient, consumerId: string, key: string): Promise<boolean> {
  const query = 'SELECT 1 FROM processed_events WHERE consumer_id = ? AND key = ? LIMIT 1';
  const result = await db.execute(query, [consumerId, key], { prepare: true });
  return result.rowLength > 0;
}

async function markProcessed(db: DbClient, consumerId: string, key: string): Promise<void> {
  const query = `
    INSERT INTO processed_events (consumer_id, key, processed_at)
    VALUES (?, ?, ?)
  `;
  await db.execute(query, [consumerId, key, new Date()], { prepare: true });
}

async function recordFailure(db: DbClient, consumerId: string, key: string, error: string): Promise<number> {
  // First, check current failure count
  const selectQuery = 'SELECT failure_count FROM event_failures WHERE consumer_id = ? AND key = ? LIMIT 1';
  const selectResult = await db.execute(selectQuery, [consumerId, key], { prepare: true });
  
  const currentCount = selectResult.rowLength > 0 
    ? (selectResult.rows[0] as { failure_count?: number }).failure_count ?? 0
    : 0;
  
  const newCount = currentCount + 1;
  const now = new Date();

  const insertQuery = `
    INSERT INTO event_failures (consumer_id, key, failure_count, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `;
  await db.execute(insertQuery, [consumerId, key, newCount, error, now], { prepare: true });

  return newCount;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const consumerId = 'fabric-anchor-consumer';
  const env: Env = process.env;

  const db = await connectCassandra(env);
  await ensureTables(db);

  const { contract } = await connectFabric(env);

  const consumer: PollConsumer = (() => {
    const brokers = getLocalKafkaBrokers(env);
    if (!brokers) {
      throw new Error('Kafka consumer requires either Upstash Kafka env vars or local KAFKA_BROKER(S)');
    }
    const consumerGroupId = (env.KAFKA_CONSUMER_GROUP_ID ?? 'fabric-anchor-consumer-v1').trim();
    const instanceId = (env.KAFKA_CONSUMER_INSTANCE_ID ?? `fabric-anchor-${process.pid}`).trim();
    if (!consumerGroupId) throw new Error('KAFKA_CONSUMER_GROUP_ID cannot be empty');
    if (!instanceId) throw new Error('KAFKA_CONSUMER_INSTANCE_ID cannot be empty');
    return new LocalKafkaPollConsumer(brokers, consumerGroupId, instanceId);
  })();
  const producer = new KafkaProducer();

  const consumerGroupId = (process.env.KAFKA_CONSUMER_GROUP_ID ?? 'fabric-anchor-consumer-v1').trim();
  const instanceId = (process.env.KAFKA_CONSUMER_INSTANCE_ID ?? `fabric-anchor-${process.pid}`).trim();
  if (!consumerGroupId) throw new Error('KAFKA_CONSUMER_GROUP_ID cannot be empty');
  if (!instanceId) throw new Error('KAFKA_CONSUMER_INSTANCE_ID cannot be empty');

  const batch: Array<{ raw: any; event: ComplaintSubmittedEvent }> = [];
  let lastFlushAt = Date.now();
  let flushing = false;
  let shutdown = false;

  async function sendDlq(rawMessage: unknown, attempts: number, error: string): Promise<void> {
    const dlq: DlqEvent = {
      type: 'dlq.events',
      idempotencyKey: crypto.randomUUID(),
      occurredAt: nowIso(),
      version: 1,
      originalTopic: KafkaTopics.complaintSubmitted,
      consumerId,
      attempts,
      error,
      rawMessage
    };
    await producer.publish(KafkaTopics.dlq, dlq);
  }

  async function alertOps(template: string, params: Record<string, string>): Promise<void> {
    const evt: NotificationSendEvent = {
      type: 'notification.send',
      idempotencyKey: crypto.randomUUID(),
      occurredAt: nowIso(),
      version: 1,
      channels: ['push'],
      template,
      to: {},
      params,
      priority: 'high'
    };
    await producer.publish(KafkaTopics.notificationSend, evt);
  }

  async function flush(reason: 'size' | 'timer'): Promise<void> {
    if (flushing) return;
    if (batch.length === 0) {
      lastFlushAt = Date.now();
      return;
    }
    flushing = true;

    try {
      const unique: Array<{ raw: any; event: ComplaintSubmittedEvent }> = [];
      for (const item of batch) {
        const key = item.event.idempotencyKey;
        if (await isProcessed(db, consumerId, key)) {
          continue;
        }
        unique.push(item);
      }

      if (unique.length === 0) {
        await consumer.commit({ consumerGroupId, instanceId });
        batch.length = 0;
        lastFlushAt = Date.now();
        return;
      }

      const leaves = unique.map(u => stableStringify({ complaintId: u.event.complaintId, idempotencyKey: u.event.idempotencyKey }));
      const { root, proofs } = merkleRoot(leaves);
      const batchId = crypto.randomUUID();

      // Use Fabric Gateway API to submit a transaction and capture its tx ID.
      const proposal = contract.newProposal('AnchorMerkleRoot', {
        arguments: [batchId, root, unique.length.toString()]
      });
      const fabricTxId = proposal.getTransactionId();
      const endorsed = await proposal.endorse();
      const submitted = await endorsed.submit();
      await submitted.getStatus();

      for (let i = 0; i < unique.length; i++) {
        const { event } = unique[i]!;
        const proof = proofs[i]!;
        const now = new Date();

        // Insert into primary table
        const insertQuery = `
          INSERT INTO complaint_merkle_proofs 
            (complaint_id, merkle_root, merkle_proof, fabric_txid, batch_id, anchored_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        await db.execute(insertQuery, 
          [event.complaintId, root, JSON.stringify(proof), fabricTxId, batchId, now],
          { prepare: true }
        );

        // Insert into batch index table
        const insertBatchQuery = `
          INSERT INTO complaint_merkle_proofs_by_batch 
            (batch_id, complaint_id, merkle_root, merkle_proof, fabric_txid, anchored_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        await db.execute(insertBatchQuery,
          [batchId, event.complaintId, root, JSON.stringify(proof), fabricTxId, now],
          { prepare: true }
        );

        await markProcessed(db, consumerId, event.idempotencyKey);

        await producer.publish(KafkaTopics.complaintAnchored, {
          type: 'complaint.anchored',
          idempotencyKey: crypto.randomUUID(),
          occurredAt: nowIso(),
          version: 1,
          complaintId: event.complaintId,
          merkleRoot: root,
          merkleProof: proof,
          fabricTxId,
          batchId
        });
      }

      // Commit only after Fabric confirms + DB writes complete.
      await consumer.commit({ consumerGroupId, instanceId });
      batch.length = 0;
      lastFlushAt = Date.now();
      if (reason === 'size') {
        console.log(`[${consumerId}] Anchored batch of ${unique.length} complaints; root=${root} tx=${fabricTxId}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);

      // Record failures and DLQ any messages that have exceeded retry budget.
      for (const item of batch) {
        const attempts = await recordFailure(db, consumerId, item.event.idempotencyKey, error);
        if (attempts >= 3) {
          await sendDlq(item.raw, attempts, error);
          await markProcessed(db, consumerId, item.event.idempotencyKey);
        }
      }

      await alertOps('fabric_anchor_consumer_failure', {
        error,
        batchSize: String(batch.length)
      });

      // Only commit offsets if we've DLQ'd all messages in the current batch.
      const remaining = [] as typeof batch;
      for (const item of batch) {
        if (!(await isProcessed(db, consumerId, item.event.idempotencyKey))) {
          remaining.push(item);
        }
      }
      if (remaining.length === 0) {
        await consumer.commit({ consumerGroupId, instanceId });
        batch.length = 0;
        lastFlushAt = Date.now();
      }

      console.error(`[${consumerId}] flush failed: ${error}`);
    } finally {
      flushing = false;
    }
  }

  const timer = setInterval(() => {
    if (shutdown) return;
    if (flushing) return;
    if (batch.length === 0) return;
    if (Date.now() - lastFlushAt >= 60_000) {
      void flush('timer');
    }
  }, 1_000);

  const onSignal = (signal: string) => {
    console.log(`[${consumerId}] received ${signal}, shutting down...`);
    shutdown = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  while (!shutdown) {
    if (flushing) {
      await new Promise(r => setTimeout(r, 50));
      continue;
    }

    const messages = await consumer.consume({
      consumerGroupId,
      instanceId,
      topics: [KafkaTopics.complaintSubmitted],
      timeout: 5_000,
      autoCommit: false,
      autoOffsetReset: 'earliest'
    });

    let addedToBatch = 0;
    let malformedOnly = messages.length > 0;
    for (const msg of messages) {
      try {
        const parsed = JSON.parse(msg.value) as ComplaintSubmittedEvent;
        if (!parsed?.idempotencyKey || !parsed?.complaintId) {
          throw new Error('Invalid complaint.submitted payload');
        }
        batch.push({ raw: msg, event: parsed });
        addedToBatch++;
        malformedOnly = false;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const key = crypto.randomUUID();
        const attempts = await recordFailure(db, consumerId, key, error);
        await sendDlq(msg, attempts, error);
        await markProcessed(db, consumerId, key);
      }
    }

    // If we only saw malformed/poison messages in this poll, DLQ'd them, and
    // didn't add anything to the batch, commit offsets now to prevent redelivery.
    if (malformedOnly && addedToBatch === 0) {
      await consumer.commit({ consumerGroupId, instanceId });
    }

    if (batch.length >= 100) {
      await flush('size');
    }
  }

  clearInterval(timer);
  await flush('timer');
  await consumer.disconnect?.();
  await db.shutdown();
}

main().catch(err => {
  console.error('[fabric-anchor-consumer] fatal:', err);
  process.exitCode = 1;
});
