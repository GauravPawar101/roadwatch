# Messaging (Kafka and Redis)

Dual Kafka clusters and Redis configuration for RoadWatch.

## Kafka clusters

| Cluster | Host port | Internal | Zookeeper | Purpose |
|---------|-----------|----------|-----------|---------|
| kafka-hlf | 9094 | kafka-hlf:29092 | 2181 | HLF backpressure buffer |
| kafka-events | 9095 | kafka-events:29092 | 2182 | Notifications, SLA, webhooks |

### Why two clusters?

- **HLF cluster** absorbs write spikes (1000s events/s) while Fabric commits at 10–100 tx/s.
- **Events cluster** handles operational side effects independently — a slow Fabric anchor does not block notifications.

### Topics

Defined in `config/messaging-topology.json`:

| Topic | Partitions | Cluster |
|-------|------------|---------|
| `complaint-submitted` | 6 | Both |
| `complaint-anchored` | 3 | Events |
| `complaint-status-changed` | 6 | Both |
| `notification-send` | 2 | Events |
| `authority-action` | 2 | Events |
| `escalation-due` | 2 | Events |
| `escalation-sent` | 2 | Events |
| `media-captured` | 3 | Events |
| `media-uploaded` | 3 | Events |
| `media-analyzed` | 3 | Events |
| `fabric-events` | 2 | Events |
| `dlq-events` | 3 | Both |


Partition counts for `complaint-submitted` / `complaint-status-changed` are set to **6** so `fabric-anchor-consumer` can scale up to that many replicas (one consumer per partition). Webhook HPA scales on CPU independently on the events cluster.

### Initialize topics

```powershell
pwsh -File scripts/init-messaging.ps1
```

This creates topics on both clusters based on `config/messaging-topology.json`.

### Application configuration

| Variable | Value (local) |
|----------|---------------|
| `KAFKA_HLF_BROKERS` | `127.0.0.1:9094` |
| `KAFKA_EVENTS_BROKERS` | `127.0.0.1:9095` |

Inside Docker containers, use internal broker addresses (`kafka-hlf:29092`, `kafka-events:29092`).

## Redis

Single Redis instance with logical database separation:

| DB index | Service | Key patterns |
|----------|---------|--------------|
| 0 | Gateway API | `otp:*`, `otp_rate:*`, `idempotency:*`, `complaints:*` |
| 1 | Webhook handler | Transient processing cache |
| 2 | Fabric anchor consumer | Batch deduplication |

### Configuration

| Variable | Value (local) |
|----------|---------------|
| `REDIS_URL` (gateway) | `redis://127.0.0.1:16379/0` |
| `REDIS_URL` (webhook) | `redis://127.0.0.1:16379/1` |
| `REDIS_URL` (fabric-anchor) | `redis://127.0.0.1:16379/2` |

Host port: `16379` (container internal: `6379`).

## Testing events

Produce test events for debugging:

```powershell
tsx tools/produce-test-events.ts
```

## Related docs

- [Event pipeline](../architecture/event-pipeline.md)
- [Docker Compose](./docker-compose.md)
- [Ports reference](../reference/ports.md)
