import * as grpc from '@grpc/grpc-js';
import { connect, signers, type Contract, type Gateway } from '@hyperledger/fabric-gateway';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import pg from 'pg';

import { getKafkaClient } from '../../providers/kafka/KafkaClient.js';
import { KafkaProducer } from '../../providers/kafka/KafkaProducer.js';
import { KafkaTopics, type ComplaintSubmittedEvent, type DlqEvent, type NotificationSendEvent } from '../../providers/kafka/topics.js';

const { Pool } = pg;

type Direction = 'left' | 'right';
type ProofStep = { direction: Direction; hash: string };

type Env = NodeJS.ProcessEnv;

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
    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
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
    identity: { mspId: 'CitizenOrgMSP', credentials: Uint8Array.from(Buffer.from(certificate)) },
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

async function ensureTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_events (
      key text NOT NULL,
      consumer_id text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (key, consumer_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_failures (
      key text NOT NULL,
      consumer_id text NOT NULL,
      failure_count int NOT NULL DEFAULT 0,
      last_error text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (key, consumer_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_merkle_proofs (
      complaint_id text PRIMARY KEY,
      merkle_root text NOT NULL,
      merkle_proof jsonb NOT NULL,
      fabric_txid text NOT NULL,
      batch_id text NOT NULL,
      anchored_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS complaint_merkle_proofs_batch_idx ON complaint_merkle_proofs(batch_id);
  `);
}

async function isProcessed(pool: pg.Pool, consumerId: string, key: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM processed_events WHERE key = $1 AND consumer_id = $2 LIMIT 1`,
    [key, consumerId]
  );
  return (res.rowCount ?? 0) > 0;
}

async function markProcessed(pool: pg.Pool, consumerId: string, key: string): Promise<void> {
  await pool.query(
    `INSERT INTO processed_events(key, consumer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [key, consumerId]
  );
}

async function recordFailure(pool: pg.Pool, consumerId: string, key: string, error: string): Promise<number> {
  const res = await pool.query(
    `
      INSERT INTO event_failures(key, consumer_id, failure_count, last_error)
      VALUES ($1, $2, 1, $3)
      ON CONFLICT (key, consumer_id)
      DO UPDATE SET
        failure_count = event_failures.failure_count + 1,
        last_error = EXCLUDED.last_error,
        updated_at = now()
      RETURNING failure_count;
    `,
    [key, consumerId, error]
  );
  return res.rows[0]?.failure_count ?? 1;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const consumerId = 'fabric-anchor-consumer';
  const env: Env = process.env;

  const databaseUrl = requireEnv(env.DATABASE_URL, 'DATABASE_URL');
  const pool = new Pool({ connectionString: databaseUrl });
  await ensureTables(pool);

  const { contract } = await connectFabric(env);
  const consumer = getKafkaClient().consumer();
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
        if (await isProcessed(pool, consumerId, key)) {
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

      const txFactory = contract as unknown as {
        createTransaction?: (name: string) => { submit: (...args: string[]) => Promise<unknown>; getTransactionId?: () => string };
      };
      if (!txFactory.createTransaction) {
        throw new Error('Fabric Contract is missing createTransaction()');
      }

      const tx = txFactory.createTransaction('AnchorMerkleRoot');
      await tx.submit(batchId, root, unique.length.toString());
      const fabricTxId = tx.getTransactionId?.() ?? 'unknown';

      for (let i = 0; i < unique.length; i++) {
        const { event } = unique[i]!;
        const proof = proofs[i]!;
        await pool.query(
          `
            INSERT INTO complaint_merkle_proofs(complaint_id, merkle_root, merkle_proof, fabric_txid, batch_id)
            VALUES ($1, $2, $3::jsonb, $4, $5)
            ON CONFLICT (complaint_id)
            DO UPDATE SET
              merkle_root = EXCLUDED.merkle_root,
              merkle_proof = EXCLUDED.merkle_proof,
              fabric_txid = EXCLUDED.fabric_txid,
              batch_id = EXCLUDED.batch_id,
              anchored_at = now();
          `,
          [event.complaintId, root, JSON.stringify(proof), fabricTxId, batchId]
        );

        await markProcessed(pool, consumerId, event.idempotencyKey);

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
        const attempts = await recordFailure(pool, consumerId, item.event.idempotencyKey, error);
        if (attempts >= 3) {
          await sendDlq(item.raw, attempts, error);
          await markProcessed(pool, consumerId, item.event.idempotencyKey);
        }
      }

      await alertOps('fabric_anchor_consumer_failure', {
        error,
        batchSize: String(batch.length)
      });

      // Only commit offsets if we've DLQ'd all messages in the current batch.
      const remaining = [] as typeof batch;
      for (const item of batch) {
        if (!(await isProcessed(pool, consumerId, item.event.idempotencyKey))) {
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
        const attempts = await recordFailure(pool, consumerId, key, error);
        await sendDlq(msg, attempts, error);
        await markProcessed(pool, consumerId, key);
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
  await pool.end();
}

main().catch(err => {
  console.error('[fabric-anchor-consumer] fatal:', err);
  process.exitCode = 1;
});
