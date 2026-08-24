# Monitoring

Observability for RoadWatch services.

## Stack (Kubernetes)

Deployed under namespace `observability` via `k8s/base/layer-observability/`:

| Component | Access |
|-----------|--------|
| Prometheus | in-cluster `http://prometheus.observability:9090` |
| Loki | in-cluster `http://loki.observability:3100` |
| Grafana | NodePort **30301** (`http://localhost:30301`, admin/admin) |

`deploy-kind.sh` installs **Istio Ambient**, **KEDA**, then applies the overlay (including observability).

## Health checks

| Service | Endpoint | Expected |
|---------|----------|----------|
| Gateway API | `GET /health` | `200 OK` |
| Gateway admission metrics | `GET /metrics/admission` | Prometheus text |
| Backend API | `GET /health` | `200 OK` |
| Postgres | `pg_isready` | healthy |
| Redis / Sentinel | `redis-cli ping` / sentinel masters | PONG / mymaster |
| Kafka | topic list on both clusters | topics present |

## Autoscaling

- **KEDA** ScaledObjects (`k8s/base/layer-autoscaling/`) scale `webhook` and `fabric-anchor` from Kafka lag.
- Gateway / backend retain CPU/memory HPAs.

## Key metrics

| Metric | Where | Alert |
|--------|-------|-------|
| `roadwatch_outbox_unpublished` | `/metrics/admission` | Rising backlog |
| `roadwatch_outbox_dead` | `/metrics/admission` | > 0 sustained |
| Kafka consumer lag | KEDA / Kafka | Scale / investigate |
| DLQ topic growth | `dlq-events` | See [dlq.md](./dlq.md) |
| OTP rate limit hits | Redis `otp_rate:*` | Abuse spike |

## Logs

Workers log to stdout; ship via cluster logging to Loki (Grafana Explore → Loki).

| Prefix | Service |
|--------|---------|
| `[webhook]` | Webhook handler |
| `[fabric-anchor]` | Fabric anchor consumer |
| `[scheduler]` | Scheduler |

## Related docs

- [DLQ](./dlq.md)
- [Troubleshooting](./troubleshooting.md)
- [Event pipeline](../architecture/event-pipeline.md)
- [K8s architecture](../../k8s/ARCHITECTURE.md)
