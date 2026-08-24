import 'dotenv/config';

import crypto from 'crypto';
import * as grpc from '@grpc/grpc-js';
import { connect, signers, type Contract, type Gateway } from '@hyperledger/fabric-gateway';
import { promises as fs } from 'fs';
import { Kafka as KafkaJS } from 'kafkajs';
import { Pool } from 'pg';

import { fabricLedgerService } from '@roadwatch/core';
import { getHlfKafkaBrokers, KafkaProducer, KafkaTopics, type ComplaintStatusChangedEvent, type ComplaintSubmittedEvent, type DlqEvent, type NotificationSendEvent } from '@roadwatch/kafka';

type DbClient = Pool;

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

type ComplaintLedgerEvent =
  | { topic: typeof KafkaTopics.complaintSubmitted; event: ComplaintSubmittedEvent }
  | { topic: typeof KafkaTopics.complaintStatusChanged; event: ComplaintStatusChangedEvent };

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
    // Attempt to connect and subscribe with exponential backoff because the
    // Kafka group coordinator may not be ready immediately after broker start.
    let attempt = 0;
    let delay = 100; // ms
    const maxAttempts = 12; // caps total backoff ~ 40s
    while (true) {
      try {
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

        break;
      } catch (e) {
        attempt++;
        if (attempt >= maxAttempts) {
          // rethrow the last error after exhausting attempts
          throw e;
        }
        // sleep with jitter
        const jitter = Math.floor(Math.random() * Math.min(1000, delay));
        await sleep(delay + jitter);
        delay = Math.min(5000, delay * 2);
      }
    }

    if (this.runStarted) return;
    this.runStarted = true;

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

function toFabricRegionCode(input: string | null | undefined): string {
  const compact = String(input ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '');

  if (compact.length === 0) {
    return 'UNKNOWN';
  }

  return compact.length <= 10 ? compact : compact.slice(0, 10);
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

async function connectPostgres(env: Env = process.env): Promise<DbClient> {
  const connectionString = env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:16432/roadwatch';

  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
  } finally {
    client.release();
  }

  return pool;
}

async function ensureTables(db: DbClient): Promise<void> {
  // DDL centralized in docker/postgres/init.sql; runtime table creation removed.
  console.info('Skipping creation of processed_events/event_failures/complaint_merkle_proofs tables; ensure docker/postgres/init.sql has been applied');
}

async function isProcessed(db: DbClient, consumerId: string, key: string): Promise<boolean> {
  const result = await db.query(
    'SELECT 1 FROM processed_events WHERE consumer_id = $1 AND key = $2 LIMIT 1',
    [consumerId, key]
  );
  return result.rows.length > 0;
}

async function markProcessed(db: DbClient, consumerId: string, key: string): Promise<void> {
  await db.query(
    `INSERT INTO processed_events (consumer_id, key, processed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (consumer_id, key) DO NOTHING`,
    [consumerId, key]
  );
}

async function recordFailure(db: DbClient, consumerId: string, key: string, error: string): Promise<number> {
  const result = await db.query(
    `INSERT INTO event_failures (consumer_id, key, failure_count, last_error, updated_at)
     VALUES ($1, $2, 1, $3, NOW())
     ON CONFLICT (consumer_id, key) DO UPDATE SET
       failure_count = event_failures.failure_count + 1,
       last_error = $3,
       updated_at = NOW()
     RETURNING failure_count`,
    [consumerId, key, error]
  );

  return result.rows[0]?.failure_count ?? 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const consumerId = 'fabric-anchor-consumer';
  const env: Env = process.env;

  const db = await connectPostgres(env);
  await ensureTables(db);

  const { contract } = await connectFabric(env);

  const consumer: PollConsumer = (() => {
    const brokers = getHlfKafkaBrokers(env);
    if (!brokers) {
      throw new Error('Kafka consumer requires KAFKA_HLF_BROKERS (or legacy KAFKA_BROKER/S)');
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

  const batch: Array<{ raw: any; event: ComplaintSubmittedEvent | ComplaintStatusChangedEvent; topic: string }> = [];
  let lastFlushAt = Date.now();
  let flushing = false;
  let shutdown = false;
  let paused = false;
  let consecutiveFlushFailures = 0;

  const batchSizeLimit = Math.max(1, Number.parseInt(process.env.FABRIC_ANCHOR_BATCH_SIZE ?? '100', 10) || 100);
  const flushIntervalMs = Math.max(1000, Number.parseInt(process.env.FABRIC_ANCHOR_FLUSH_INTERVAL_MS ?? '60000', 10) || 60_000);
  const pauseAfterFailures = Math.max(1, Number.parseInt(process.env.FABRIC_ANCHOR_PAUSE_AFTER_FAILURES ?? '3', 10) || 3);
  const pauseMs = Math.max(1000, Number.parseInt(process.env.FABRIC_ANCHOR_PAUSE_MS ?? '15000', 10) || 15_000);

  // Lightweight circuit around Fabric RPCs
  let fabricFailures = 0;
  let fabricCircuitOpenUntil = 0;
  const fabricFailureThreshold = Math.max(1, Number.parseInt(process.env.FABRIC_CIRCUIT_FAILURES ?? '5', 10) || 5);
  const fabricCircuitOpenMs = Math.max(1000, Number.parseInt(process.env.FABRIC_CIRCUIT_OPEN_MS ?? '30000', 10) || 30_000);

  async function withFabricCircuit<T>(fn: () => Promise<T>): Promise<T> {
    if (Date.now() < fabricCircuitOpenUntil) {
      const error = new Error('Fabric circuit open');
      (error as any).statusCode = 503;
      throw error;
    }
    try {
      const result = await fn();
      fabricFailures = 0;
      return result;
    } catch (error) {
      fabricFailures += 1;
      if (fabricFailures >= fabricFailureThreshold) {
        fabricCircuitOpenUntil = Date.now() + fabricCircuitOpenMs;
        paused = true;
        console.warn(`[${consumerId}] Fabric circuit open for ${fabricCircuitOpenMs}ms`);
      }
      throw error;
    }
  }

  async function sendDlq(rawMessage: unknown, attempts: number, error: string): Promise<void> {
    const dlq: DlqEvent = {
      type: 'dlq-events',
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
      type: 'notification-send',
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
      const unique: Array<{ raw: any; event: ComplaintSubmittedEvent | ComplaintStatusChangedEvent; topic: string }> = [];
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

      const submittedEvents = unique.filter((item): item is { raw: any; event: ComplaintSubmittedEvent; topic: string } => item.topic === KafkaTopics.complaintSubmitted);
      const statusEvents = unique.filter((item): item is { raw: any; event: ComplaintStatusChangedEvent; topic: string } => item.topic === KafkaTopics.complaintStatusChanged);

      const processedSubmitted = new Array<{ event: ComplaintSubmittedEvent; proof?: ProofStep[] }>();

      for (const item of submittedEvents) {
        const event = item.event;
        const location = event.location && typeof event.location === 'object' ? event.location : { lat: event.lat ?? null, lng: event.lng ?? null };
        await withFabricCircuit(() => fabricLedgerService.createComplaint({
          complaintId: event.complaintId,
          citizenId: event.citizenId ?? event.complaintId,
          roadId: event.roadId ?? `${event.district}:${event.zone}`,
          location: location as Record<string, unknown>,
          initialIPFSCid: event.initialIPFSCid ?? '',
          authorityOrg: event.authorityOrg ?? event.zone,
          detailsHash: event.detailsHash,
          merged: event.merged,
          reportCount: event.reportCount,
          eventIdempotencyKey: event.idempotencyKey
        }));
        processedSubmitted.push({ event });
      }

      for (const item of statusEvents) {
        const event = item.event;
        await withFabricCircuit(() => fabricLedgerService.updateComplaintStatus(
          event.complaintId,
          event.toStatus,
          event.changedBy.actorId ?? 'system',
          event.idempotencyKey
        ));
      }

      if (processedSubmitted.length > 0) {
        const leaves = processedSubmitted.map(u => stableStringify({ complaintId: u.event.complaintId, idempotencyKey: u.event.idempotencyKey }));
        const { root, proofs } = merkleRoot(leaves);
        const batchId = crypto.randomUUID();

        const regionCode = toFabricRegionCode(
          processedSubmitted[0]?.event.district || processedSubmitted[0]?.event.zone || 'UNKNOWN'
        );
        const proposal = contract.newProposal('SubmitMerkleRoot', {
          arguments: [root, regionCode, processedSubmitted.length.toString()]
        });
        const fabricTxId = proposal.getTransactionId();
        const endorsed = await proposal.endorse();
        const submitted = await endorsed.submit();
        await submitted.getStatus();

        for (let i = 0; i < processedSubmitted.length; i++) {
          const { event } = processedSubmitted[i]!;
          const proof = proofs[i]!;
          const now = new Date();

          await db.query(
            `INSERT INTO complaint_merkle_proofs 
               (complaint_id, merkle_root, merkle_proof, fabric_txid, batch_id, anchored_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (complaint_id) DO UPDATE SET
               merkle_root = $2, merkle_proof = $3, fabric_txid = $4, batch_id = $5, anchored_at = $6`,
            [event.complaintId, root, JSON.stringify(proof), fabricTxId, batchId, now]
          );

          await db.query(
            `INSERT INTO complaint_merkle_proofs_by_batch 
               (batch_id, complaint_id, merkle_root, merkle_proof, fabric_txid, anchored_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (batch_id, complaint_id) DO UPDATE SET
               merkle_root = $3, merkle_proof = $4, fabric_txid = $5, anchored_at = $6`,
            [batchId, event.complaintId, root, JSON.stringify(proof), fabricTxId, now]
          );

            await producer.publish(KafkaTopics.complaintAnchored, {
            type: 'complaint-anchored',
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

        console.log(`[${consumerId}] Anchored batch of ${processedSubmitted.length} complaints; root=${root} tx=${fabricTxId}`);
      }

      for (const item of unique) {
        await markProcessed(db, consumerId, item.event.idempotencyKey);
      }

      // Commit only after Fabric confirms + DB writes complete.
      await consumer.commit({ consumerGroupId, instanceId });
      batch.length = 0;
      lastFlushAt = Date.now();
      consecutiveFlushFailures = 0;
      if (paused) {
        paused = false;
        console.log(`[${consumerId}] resuming consume after successful flush`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      consecutiveFlushFailures += 1;

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

      if (consecutiveFlushFailures >= pauseAfterFailures) {
        paused = true;
        console.warn(`[${consumerId}] pausing consume for ${pauseMs}ms after ${consecutiveFlushFailures} flush failures`);
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
    if (Date.now() - lastFlushAt >= flushIntervalMs) {
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
    if (paused) {
      await new Promise(r => setTimeout(r, pauseMs));
      paused = false;
      consecutiveFlushFailures = 0;
      console.log(`[${consumerId}] pause elapsed; resuming consume`);
      continue;
    }

    if (flushing) {
      await new Promise(r => setTimeout(r, 50));
      continue;
    }

    const messages = await consumer.consume({
      consumerGroupId,
      instanceId,
      topics: [KafkaTopics.complaintSubmitted, KafkaTopics.complaintStatusChanged],
      timeout: 5_000,
      autoCommit: false,
      autoOffsetReset: 'earliest'
    });

    let addedToBatch = 0;
    let malformedOnly = messages.length > 0;
    for (const msg of messages) {
      try {
        const parsed = JSON.parse(msg.value) as ComplaintSubmittedEvent | ComplaintStatusChangedEvent;
        if (!parsed?.idempotencyKey || !parsed?.complaintId) {
          throw new Error(`Invalid ${msg.topic} payload`);
        }

        if (msg.topic !== KafkaTopics.complaintSubmitted && msg.topic !== KafkaTopics.complaintStatusChanged) {
          throw new Error(`Unsupported topic ${msg.topic}`);
        }
        batch.push({ raw: msg, event: parsed, topic: msg.topic });
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

    if (malformedOnly && addedToBatch === 0) {
      await consumer.commit({ consumerGroupId, instanceId });
    }

    if (batch.length >= batchSizeLimit) {
      await flush('size');
    }
  }

  clearInterval(timer);
  await flush('timer');
  await consumer.disconnect?.();
  await db.end();
}

main().catch(err => {
  console.error('[fabric-anchor-consumer] fatal:', err);
  process.exitCode = 1;
});