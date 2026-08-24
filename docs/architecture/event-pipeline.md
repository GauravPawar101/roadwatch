# Event Pipeline

RoadWatch uses two separate Kafka clusters to decouple fast database writes from slow blockchain commits and operational side effects.

## Dual-cluster design

| Cluster | Host port | Internal broker | Purpose |
|---------|-----------|-----------------|---------|
| **kafka-hlf** | `9094` | `kafka-hlf:29092` | Backpressure buffer before Fabric anchoring |
| **kafka-events** | `9095` | `kafka-events:29092` | Notifications, SLA, webhooks, audit fan-out |

Each cluster has its own Zookeeper instance (ports `2181` and `2182`).

## Event flow

```
Complaint created (Gateway API)
    │
    ├─► Postgres INSERT (complaints table)
    ├─► kafka_event_outbox INSERT (same transaction)
    │
    ▼
Outbox relay (gateway or backend)
    │
    ├─► kafka-hlf: complaint-submitted
    └─► kafka-events: complaint-submitted
            │
            ├─► webhook-handler → notifications, audit log
            └─► SSE broadcast to connected clients

kafka-hlf: complaint-submitted
    │
    ▼
fabric-anchor-consumer
    ├─► Batch events → compute Merkle root
    ├─► Fabric gRPC → complaint-anchor chaincode
    ├─► Postgres anchor record
    └─► kafka-events: complaint-anchored
            │
            └─► webhook-handler → update complaint with tx hash
```

## Topics

Defined in `config/messaging-topology.json` and consumed across services:

| Topic | Cluster | Producer | Consumer(s) |
|-------|---------|----------|-------------|
| `complaint-submitted` | Both | Gateway outbox relay | fabric-anchor-consumer, webhook-handler |
| `complaint-status-changed` | Both | Gateway | fabric-anchor-consumer, webhook-handler |
| `complaint-anchored` | Events | fabric-anchor-consumer | webhook-handler |
| `notification-send` | Events | Gateway, scheduler | webhook-handler |
| `authority-action` | Events | Gateway | webhook-handler |
| `escalation-due` | Events | Scheduler | webhook-handler |
| `escalation-sent` | Events | webhook-handler | — |
| `media-captured` | Events | Mobile, gateway | media-ingest |
| `media-uploaded` | Events | media-ingest | webhook-handler |
| `media-analyzed` | Events | media-ingest | webhook-handler |
| `dlq-events` | Both | Any (on failure) | `scripts/dlq-redrive.sh` |


Initialize topics on first setup:

```powershell
pwsh -File scripts/init-messaging.ps1
```

## Transactional outbox

The gateway does not publish directly to Kafka during request handling. Instead:

1. Complaint insert and outbox row are committed in one Postgres transaction.
2. A background relay reads unpublished outbox rows.
3. The relay publishes to the correct cluster(s) based on event type.
4. On success, the outbox row is marked published.

This guarantees at-least-once delivery without losing events on API crashes.

## Redis allocation

| DB index | Service | Purpose |
|----------|---------|---------|
| 0 | Gateway API | OTP, rate limiting, idempotency |
| 1 | Webhook handler | Transient processing cache |
| 2 | Fabric anchor consumer | Batch deduplication, backpressure |

## Real-time updates (SSE)

The gateway exposes Server-Sent Events for live complaint status updates. Clients connect to the SSE endpoint; the gateway pushes events when kafka-events consumers update state or when direct API mutations occur.

## Failure handling

- **DLQ**: Failed events route to `dlq-events` (both clusters). Outbox rows become `DEAD` after max attempts. Use [`docs/operations/dlq.md`](../operations/dlq.md) / `scripts/dlq-redrive.sh` to inspect and redrive.
- **Idempotency**: Redis keys prevent duplicate processing across consumer restarts.
- **Offset commit**: fabric-anchor-consumer commits Kafka offsets only after successful Fabric anchoring.

## Related docs

- [Blockchain anchoring](../workflows/blockchain-anchoring.md)
- [Messaging infrastructure](../infrastructure/messaging.md)
- [Webhook handler](../services/webhook-handler.md)
