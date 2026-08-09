# Blockchain Anchoring

How complaint events are batched, hashed, and anchored to Hyperledger Fabric for immutable audit trails.

## Overview

RoadWatch does not store full complaint data on the blockchain. Instead, it anchors **Merkle roots** of batched complaint hashes, providing cryptographic proof that complaints existed at a point in time.

## Pipeline

```
1. Complaint submitted (Gateway API)
       │
2. kafka_event_outbox → kafka-hlf: complaint-submitted
       │
3. fabric-anchor-consumer receives event
       │
4. Events accumulate in batch (size/timeout threshold)
       │
5. Merkle root computed over complaint hashes
       │
6. gRPC call to Fabric Gateway
       │   Channel: roadwatch-india
       │   Chaincode: complaint-anchor
       │   Function: AnchorBatch(merkleRoot, complaintIds[], timestamps[])
       │
7. Fabric transaction committed (Raft ordering)
       │
8. Anchor record saved to Postgres (complaint_anchors table)
       │
9. kafka-events: complaint-anchored published
       │
10. webhook-handler updates complaint with tx hash
```

## Batch configuration

The fabric-anchor-consumer batches events before anchoring:

- **Batch size**: Maximum events per batch (configurable)
- **Batch timeout**: Maximum wait time before flushing a partial batch
- **Redis deduplication**: Prevents re-anchoring the same batch after restarts

## Querying the ledger

### CLI (from repo root)

```powershell
pnpm fabric:query:history     # Complaint history by ID
pnpm fabric:query:by-road     # Complaints by road ID
pnpm fabric:seed              # Seed test data on ledger
```

### API

Gateway exposes Fabric query endpoints for authority users:

- Complaint anchor status and tx hash
- Escalation history (requires CouchDB state DB)

### Chaincode functions

| Function | Purpose |
|----------|---------|
| `AnchorBatch` | Store Merkle root + complaint references |
| `GetComplaintHistory` | Query all anchors for a complaint ID |
| `GetComplaintsByRoad` | Query all complaints on a road |
| `GetEscalationHistory` | Rich query escalation events (CouchDB only) |

## Failure and recovery

| Scenario | Behavior |
|----------|----------|
| Fabric peer down | Consumer retries with backoff; events stay in Kafka |
| Max retries exceeded | Event routed to `dlq-events` topic |
| Consumer restart | Redis prevents duplicate batch submission |
| Offset commit | Only after successful Fabric transaction |

## Court-admissible receipts

Each anchored complaint receives a transaction hash (`txHash`) stored in Postgres. This hash links to the Fabric block containing the Merkle root, providing a tamper-evident audit trail suitable for legal evidence.

## Prerequisites

1. Fabric network running: `pnpm fabric:start`
2. Chaincode deployed: `pnpm fabric:deploy`
3. fabric-anchor-consumer configured with Fabric credentials
4. Kafka HLF cluster healthy

## Related docs

- [Fabric network](../architecture/fabric-network.md)
- [Fabric anchor consumer](../services/fabric-anchor-consumer.md)
- [Event pipeline](../architecture/event-pipeline.md)
- [Fabric deployment](../infrastructure/fabric-deployment.md)
