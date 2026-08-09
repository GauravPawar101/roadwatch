# Ports Reference

All default ports for local development.

## Application servers

| Service | URL | Env variable |
|---------|-----|--------------|
| Gateway API | http://127.0.0.1:3100 | `PORT` |
| Backend API | http://127.0.0.1:4001 | `BACKEND_PORT` (fallback: 5001) |
| Frontend (Vite) | http://127.0.0.1:5173 | `VITE_PORT` |
| Media ingest | http://127.0.0.1:4000 | `PORT` (profile: `media`) |

## Docker Compose (host ports)

| Service | Host port | Container port | Override env |
|---------|-----------|----------------|--------------|
| PostgreSQL | 15433 | 5432 | `TOP_POSTGRES_HOST_PORT` |
| PgBouncer | 16432 | 6432 | `TOP_PGBOUNCER_HOST_PORT` |
| Kafka HLF | 9094 | 9092 | `TOP_KAFKA_HLF_HOST_PORT` |
| Kafka Events | 9095 | 9092 | `TOP_KAFKA_EVENTS_HOST_PORT` |
| Zookeeper HLF | 2181 | 2181 | `TOP_ZOOKEEPER_HLF_HOST_PORT` |
| Zookeeper Events | 2182 | 2181 | `TOP_ZOOKEEPER_EVENTS_HOST_PORT` |
| Redis | 16379 | 6379 | `TOP_REDIS_HOST_PORT` |

### Internal broker addresses (inside Docker network)

| Cluster | Address |
|---------|---------|
| Kafka HLF | `kafka-hlf:29092` |
| Kafka Events | `kafka-events:29092` |
| Postgres | `postgres:5432` |
| PgBouncer | `pgbouncer:6432` |
| Redis | `redis:6379` |

## Fabric (WSL / Docker host)

| Component | Host port |
|-----------|-----------|
| Orderer | 17050 |
| peer0.nhai | 17051 (chaincode 17052, CA 17054) |
| peer0.roadwatch | 19051 (chaincode 19052, CA 18054) |

## Kind (Kubernetes)

| Service | Host port | NodePort |
|---------|-----------|----------|
| Frontend | 8080 | 30080 |
| Gateway | 3100 | 30100 |
| Backend | 4001 | 30401 |

## Connection strings (local)

```
# Applications (via PgBouncer)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:16432/roadwatch

# Direct Postgres (debugging)
postgresql://postgres:postgres@127.0.0.1:15433/roadwatch

# Redis (gateway)
REDIS_URL=redis://127.0.0.1:16379/0

# Kafka
KAFKA_HLF_BROKERS=127.0.0.1:9094
KAFKA_EVENTS_BROKERS=127.0.0.1:9095
```

## Port override example

```powershell
$env:TOP_POSTGRES_HOST_PORT = "5433"
$env:TOP_PGBOUNCER_HOST_PORT = "6432"
docker compose up -d
```
