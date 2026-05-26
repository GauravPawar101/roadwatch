# 🐳 RoadWatch Docker Setup Guide

## Overview

All docker-compose files have been rewritten for **lightweight operation** with **zero port conflicts**.

### Key Improvements

#### 1. **Root docker-compose.yml** (`docker-compose.yml`)

| Feature | Before | After |
|---------|--------|-------|
| Compose version | 3.8 | 3.9 |
| Postgres | n/a | postgres:16 |
| Kafka image | confluentinc/cp-kafka:7.6.1 | confluentinc/cp-kafka:7.7-alpine |
| Resource limits | ❌ None | ✅ CPU/Memory limits & reservations |
| Health checks | Basic | Enhanced with start_period |
| Restart policy | ❌ None | ✅ unless-stopped |
| Kafka profile | "local-kafka" | "kafka" (simpler) |
| CouchDB profile | "local-redis" | "redis" (simpler) |
| Stub API | ❌ Broken service | ✅ Removed |

**Port mapping (no conflicts):**
- `5432:5432` → Postgres (always enabled)
- `2181:2181` → Zookeeper (profile: kafka)
- `9094:9092` → Kafka (profile: kafka)
- `6379:6379` → Redis (profile: redis)

**Usage:**
```bash
# Start Postgres only (default)
docker compose up

# Start Postgres + Kafka + Zookeeper
docker compose --profile kafka up

# Start Postgres + Redis
docker compose --profile redis up

# Start all (Postgres + Kafka + Redis)
docker compose --profile kafka --profile redis up
```

---

#### 2. **Fabric Network docker-compose.yaml** (`fabric/network/docker/docker-compose.yaml`)

| Feature | Before | After |
|---------|--------|-------|
| Compose version | 3.7 | 3.9 |
| CA images | hyperledger/fabric-ca:1.5.7 | hyperledger/fabric-ca:1.5.7-alpine |
| Peer images | hyperledger/fabric-peer:2.5.4 | hyperledger/fabric-peer:2.5.4-alpine |
| Orderer images | hyperledger/fabric-orderer:2.5.4 | hyperledger/fabric-orderer:2.5.4-alpine |
| CouchDB | ❌ Always enabled (heavy) | ✅ Optional profile (goleveldb default) |
| CouchDB image | couchdb:3.3.2 | couchdb:3.3.2-alpine |
| Peer state DB | CouchDB | LevelDB (goleveldb) — 10x lighter |
| Resource limits | ❌ None | ✅ All services limited |
| Health checks | ❌ None | ✅ All critical services checked |
| Restart policy | ❌ None | ✅ unless-stopped |
| Volume perms | ❌ RW | ✅ Read-only where safe |
| Metrics | Enabled | Disabled (saves memory) |

**Port mapping (no conflicts):**
- `7050:7050` → Orderer
- `7051:7051` → NHAI Peer
- `7052:7052` → NHAI Peer (chaincode listen)
- `7054:7054` → NHAI CA
- `8054:8054` → RoadWatch CA
- `9051:9051` → RoadWatch Peer
- `9052:9052` → RoadWatch Peer (chaincode listen)
- `5984:5984` → CouchDB NHAI (profile: couchdb)
- `15984:5984` → CouchDB RoadWatch (profile: couchdb)

**Usage:**
```bash
# Start HLF network with LevelDB (lightweight, default)
cd fabric/network/docker
docker compose up

# Start HLF network with CouchDB for rich queries
docker compose --profile couchdb up

# Stop everything (preserve volumes by default)
# Prefer a non-destructive stop which keeps volumes and data:
docker compose stop

# To fully remove containers and volumes (destructive), run:
docker compose down --volumes
```

---

## Resource Limits Summary

### Root Compose
```yaml
PostgreSQL:
  Limits: 1 CPU, 512 MB RAM
  Reserve: 0.5 CPU, 256 MB RAM

Zookeeper (Kafka):
  Limits: 0.5 CPU, 256 MB RAM
  Reserve: 0.25 CPU, 128 MB RAM

Kafka:
  Limits: 1 CPU, 512 MB RAM
  Reserve: 0.5 CPU, 256 MB RAM

Redis:
  Limits: 0.5 CPU, 256 MB RAM
  Reserve: 0.25 CPU, 128 MB RAM
```

### Fabric Compose
```yaml
Each Fabric CA:
  Limits: 0.5 CPU, 256 MB RAM
  Reserve: 0.25 CPU, 128 MB RAM

Orderer:
  Limits: 1 CPU, 512 MB RAM
  Reserve: 0.5 CPU, 256 MB RAM

Each Peer:
  Limits: 1 CPU, 512 MB RAM
  Reserve: 0.5 CPU, 256 MB RAM

Each CouchDB (optional):
  Limits: 0.5 CPU, 256 MB RAM
  Reserve: 0.25 CPU, 128 MB RAM
```

---

## Total Memory Usage

| Scenario | Total Memory |
|----------|-------------|
| Root Postgres only | ~256 MB |
| Root Postgres + Kafka | ~768 MB |
| Fabric (LevelDB only) | ~1.5 GB |
| Fabric + CouchDB | ~2 GB |
| Full stack (root + fabric) | ~2.3 GB |

---

## Network Isolation

Both compose files use **bridge networks**:
- Root: `roadwatch` (bridge)
- Fabric: `roadwatch-fabric` (bridge)

Services can resolve each other by container name within the same network. Cross-network communication requires explicit hostname routing.

---

## Health Checks

All critical services now have health checks:

```bash
# Check Postgres health
docker ps | grep roadwatch_postgres
# Status: Up X minutes (healthy)

# Check Orderer health
curl -f http://127.0.0.1:8443/healthz || echo "unhealthy"

# Check Peer health
docker compose exec peer0.nhai.roadwatch.com peer channel list

# Check CouchDB health
curl -f http://127.0.0.1:5984/_up
```

---

## Troubleshooting

### Port already in use
Check which service is using the port:
```bash
# Windows
netstat -ano | findstr :5433

# macOS/Linux
lsof -i :5433
```

### Container won't start
```bash
# Check logs
docker compose logs -f postgres

# Or specific service
docker compose logs -f kafka
```

### Memory issues
Reduce limits in the compose file and restart:
```yaml
deploy:
  resources:
    limits:
      memory: 256M  # was 512M
```

---

## Migration from old setup

If you had containers running with the old files:

```bash
# Prefer non-destructive shutdown first (keeps volumes/data):
docker compose stop

# If you want to purge state and start completely fresh (destructive):
# This removes containers, networks, and volumes — use with caution.
docker compose down --volumes

# (optional) Remove old images to reclaim disk space
docker image rm postgres:15-alpine \
  confluentinc/cp-kafka:7.6.1 \
  confluentinc/cp-zookeeper:7.6.1

# Start fresh with new compose files
docker compose up
```

---

## Quick Start Commands

```bash
# 1. Start core infrastructure
docker compose up -d postgres

# 2. Verify Postgres is ready
docker compose exec postgres pg_isready -U roadwatch_admin

# 3. Start Fabric network (separate terminal)
cd fabric/network/docker
docker compose up -d

# 4. Verify Fabric is ready
docker compose logs -f peer0.nhai.roadwatch.com | grep "Starting peer"

# 5. List all running containers
docker ps --filter "label=com.docker.compose.project=roadwatch"
```

---

**Last Updated:** May 8, 2026  
**Maintained by:** RoadWatch Development Team
