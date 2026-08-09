# Fabric Anchor Consumer

Consumes complaint events from the HLF Kafka cluster, batches them into Merkle roots, anchors to Hyperledger Fabric, and publishes confirmation to the events cluster.

## Details

| Property | Value |
|----------|-------|
| Package | `@roadwatch/fabric-anchor-consumer` |
| Entry | `services/fabric-anchor-consumer/index.ts` |
| Dev command | `pnpm dev:fabric-consumer` |
| HTTP server | None (Kafka consumer only) |

## Flow

1. Consume `complaint-submitted` and `complaint-status-changed` from **kafka-hlf** (`9094`).
2. Accumulate events into batches (configurable batch size and timeout).
3. Compute Merkle root over complaint hashes.
4. Submit anchor transaction to Fabric via gRPC Gateway (`complaint-anchor` chaincode).
5. Persist anchor record in Postgres (`complaint_anchors` table).
6. Publish `complaint-anchored` event to **kafka-events** (`9095`).
7. Commit Kafka offset only after successful Fabric transaction.

## Environment

| Variable | Purpose |
|----------|---------|
| `KAFKA_HLF_BROKERS` | HLF cluster (`127.0.0.1:9094`) |
| `KAFKA_EVENTS_BROKERS` | Events cluster (`127.0.0.1:9095`) |
| `KAFKA_CONSUMER_GROUP_ID` | Consumer group |
| `REDIS_URL` | DB 2 — batch deduplication |
| `FABRIC_PEER_ENDPOINT` | Peer gRPC address |
| `FABRIC_MSP_ID` | MSP identity |
| `FABRIC_CHANNEL_NAME` | `roadwatch-india` |
| `FABRIC_CHAINCODE_NAME` | `complaint-anchor` |
| `DATABASE_URL` | Postgres for anchor records |

## Failure handling

- Failed Fabric transactions retry with exponential backoff.
- After max retries, events route to `dlq-events` topic.
- Redis prevents duplicate batch processing across restarts.

## Docker

Runs as `roadwatch_fabric_anchor_consumer` container in the default Docker Compose stack. For development with hot reload, run via `pnpm dev:fabric-consumer` instead.

## Related docs

- [Blockchain anchoring](../workflows/blockchain-anchoring.md)
- [Fabric network](../architecture/fabric-network.md)
- [Event pipeline](../architecture/event-pipeline.md)
