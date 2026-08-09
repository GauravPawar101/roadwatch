# Monitoring

Observability for RoadWatch services.

## Health checks

| Service | Endpoint | Expected |
|---------|----------|----------|
| Gateway API | `GET /health` | `200 OK` |
| Backend API | `GET /health` | `200 OK` |
| Postgres | `pg_isready` (Docker healthcheck) | healthy |
| Kafka | `kafka-topics --list` (Docker healthcheck) | topics listed |
| Redis | `redis-cli ping` | `PONG` |

## Docker monitoring

```powershell
docker compose ps              # Service status
docker compose logs -f         # All logs
docker compose logs -f gateway # Specific service (if in compose)
pnpm infra:logs                # Alias for logs -f
```

## Kubernetes monitoring

```powershell
pnpm k8s:status                           # Pod status
pnpm k8s:logs                             # Gateway logs
kubectl get pods -n roadwatch             # All pods
kubectl logs -n roadwatch -l app=gateway  # Gateway logs
kubectl describe pod <name> -n roadwatch  # Pod details
```

## Application logs

Background workers log to stdout with prefixed tags:

| Prefix | Service |
|--------|---------|
| `[webhook]` | Webhook handler |
| `[fabric-anchor]` | Fabric anchor consumer |
| `[scheduler]` | Scheduler cron jobs |
| `[seed-demo]` | Demo data seeder |

## Key metrics to watch

| Metric | Where | Alert threshold |
|--------|-------|-----------------|
| Kafka consumer lag | kafka-hlf, kafka-events | > 1000 messages |
| Fabric anchor failures | fabric-anchor-consumer logs | Any DLQ events |
| Postgres connections | PgBouncer stats | > 80% pool utilization |
| OTP rate limit hits | Redis `otp_rate:*` keys | Spike indicates abuse |
| Complaint SLA breaches | scheduler logs | `escalation-due` events |

## Audit log

All significant actions are recorded in the `audit_log` table:

- Complaint status changes
- Authority actions
- RTI filings and responses
- Fabric anchor confirmations

Query via Postgres or authority analytics dashboard.

## Production recommendations

- Add Prometheus metrics exporters to gateway and workers
- Set up Grafana dashboards for Kafka lag, API latency, error rates
- Configure alerting on DLQ topic growth
- Enable Postgres slow query logging
- Use structured JSON logging in production

## Related docs

- [Troubleshooting](./troubleshooting.md)
- [Event pipeline](../architecture/event-pipeline.md)
- [Docker Compose](../infrastructure/docker-compose.md)
