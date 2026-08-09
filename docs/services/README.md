# Services

RoadWatch consists of four deployable applications, four background services, and twelve shared packages.

## Applications

| Service | Package | Port | Doc |
|---------|---------|------|-----|
| Gateway API | `@roadwatch/gateway-api` | 3100 | [gateway-api.md](./gateway-api.md) |
| Backend API | `@roadwatch/backend-api` | 4001 | [backend-api.md](./backend-api.md) |
| Frontend | `roadwatch-frontend` | 5173 | [frontend.md](./frontend.md) |
| Mobile Host | `@roadwatch/mobile-host` | Metro | [mobile-host.md](./mobile-host.md) |

## Background services

| Service | Package | Port | Doc |
|---------|---------|------|-----|
| Fabric Anchor Consumer | `@roadwatch/fabric-anchor-consumer` | — | [fabric-anchor-consumer.md](./fabric-anchor-consumer.md) |
| Webhook Handler | `@roadwatch/webhook-handler` | — | [webhook-handler.md](./webhook-handler.md) |
| Scheduler | `@roadwatch/scheduler` | — | [scheduler.md](./scheduler.md) |
| Media Ingest | `media-ingest-prototype` | 4000 | [media-ingest.md](./media-ingest.md) |

## Shared packages

See [shared-packages.md](./shared-packages.md) for the full package inventory.

## Service discovery

In development, the frontend and backend register with the gateway service registry on startup. In production/k8s, services communicate via cluster DNS names defined in ConfigMaps.

## Docker Compose services

The root `docker-compose.yml` runs infrastructure and background workers. Application servers (gateway, backend, frontend) run as local Node processes by default, not in Docker.

| Container | Image / build | Always on |
|-----------|---------------|-----------|
| `roadwatch_postgres` | postgres:15-alpine | Yes |
| `roadwatch_pgbouncer` | edoburu/pgbouncer | Yes |
| `roadwatch_kafka_hlf` | confluentinc/cp-kafka:7.7.0 | Yes |
| `roadwatch_kafka_events` | confluentinc/cp-kafka:7.7.0 | Yes |
| `roadwatch_redis` | redis:7-alpine | Yes |
| `roadwatch_scheduler` | Built from repo | Yes |
| `roadwatch_webhook_handler` | Built from repo | Yes |
| `roadwatch_fabric_anchor_consumer` | Built from repo | Yes |
| `roadwatch_media_ingest` | Built from repo | Profile: `media` |
