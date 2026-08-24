# Dead-letter queue (DLQ)

RoadWatch uses the Kafka topic `dlq-events` (mirrored on **both** HLF and events clusters) for poison / exhausted messages.

## Producers

| Source | When |
|--------|------|
| `fabric-anchor-consumer` | After ≥3 Fabric/processing failures or malformed payloads |
| `webhook-handler` | After ≥`WEBHOOK_MAX_ATTEMPTS` (default 3) handler failures |
| `gateway-api` outbox relay | After ≥10 publish attempts → row status `DEAD` + DLQ event |

## Inspect / redrive

```bash
./scripts/dlq-redrive.sh list --max 50
./scripts/dlq-redrive.sh redrive --offset 12 --dry-run
./scripts/dlq-redrive.sh redrive --offset 12
```

Env: `KAFKA_EVENTS_BROKERS` (default `127.0.0.1:9095`).

## Metrics / alerts

- Gateway `GET /metrics/admission` exposes `roadwatch_outbox_dead`.
- Prometheus (observability namespace) scrapes gateway admission metrics.
- Alert on sustained DLQ growth and non-zero `roadwatch_outbox_dead`.

## Related

- [event-pipeline.md](../architecture/event-pipeline.md)
- [messaging.md](../infrastructure/messaging.md)
- [monitoring.md](./monitoring.md)
