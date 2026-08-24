# Docker Compose

Local infrastructure stack defined in the root `docker-compose.yml`.

## Start

```powershell
# Default stack (all infrastructure + workers)
docker compose up -d

# With optional media ingest
docker compose --profile media up -d

# View status
docker compose ps

# View logs
docker compose logs -f
pnpm infra:logs
```

## Services

All services start by default. There is **no `kafka` or `redis` profile** — those are always included.

| Service | Container | Host port | Internal | Purpose |
|---------|-----------|-----------|----------|---------|
| postgres | `roadwatch_postgres` | 15433 | 5432 | Primary database |
| pgbouncer | `roadwatch_pgbouncer` | 16432 | 6432 | Connection pooler |
| kafka-hlf | `roadwatch_kafka_hlf` | 9094 | 29092 | KRaft HLF backpressure buffer |
| kafka-events | `roadwatch_kafka_events` | 9095 | 29092 | KRaft operational event bus |
| redis | `roadwatch_redis` | 16379 | 6379 | Cache, OTP, idempotency |
| scheduler | `roadwatch_scheduler` | — | — | Cron worker |
| webhook-handler | `roadwatch_webhook_handler` | — | — | Kafka events consumer |
| fabric-anchor-consumer | `roadwatch_fabric_anchor_consumer` | — | — | Kafka HLF → Fabric |

### Optional profile: `media`

| Service | Container | Host port | Purpose |
|---------|-----------|-----------|---------|
| media-ingest | `roadwatch_media_ingest` | 4000 | Image upload/analysis |

## Port overrides

Set environment variables before `docker compose up`:

| Variable | Default |
|----------|---------|
| `TOP_POSTGRES_HOST_PORT` | 15433 |
| `TOP_PGBOUNCER_HOST_PORT` | 16432 |
| `TOP_KAFKA_HLF_HOST_PORT` | 9094 |
| `TOP_KAFKA_EVENTS_HOST_PORT` | 9095 |
| `TOP_REDIS_HOST_PORT` | 16379 |
| `TOP_ZOOKEEPER_HLF_HOST_PORT` | 2181 |
| `TOP_ZOOKEEPER_EVENTS_HOST_PORT` | 2182 |
| `MEDIA_BACKEND_HOST_PORT` | 4000 |

## Volumes

| Volume | Purpose |
|--------|---------|
| `postgres_data` | Persistent Postgres data |

## Safe stop and reset

```powershell
# Stop containers, preserve data
docker compose stop
pnpm infra:down          # docker compose down (keeps volumes)

# Full reset (DELETES ALL DATA)
pnpm infra:reset         # docker compose down --volumes
```

**Warning:** `docker compose down --volumes` deletes Postgres data, Kafka offsets, and Redis cache. Use only when you want a clean slate.

## Application servers

Gateway API, backend API, and frontend run as **local Node processes** by default, not in Docker. Use `pnpm dev` or `pnpm start:all` to launch them.

Background workers (scheduler, webhook-handler, fabric-anchor-consumer) run in Docker by default. For hot-reload development, run them locally instead:

```powershell
pnpm dev:scheduler
pnpm dev:webhook
pnpm dev:fabric-consumer
```

## Postgres initialization

On first start, `docker/postgres/init.sql` runs automatically to create the schema. See [Database](./database.md).

## Related docs

- [Ports reference](../reference/ports.md)
- [Messaging](./messaging.md)
- [Local development](../getting-started/local-development.md)
