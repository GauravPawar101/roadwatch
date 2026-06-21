# 🔄 Docker Quick Reference Card

## Start Infrastructure

```bash
# Postgres only (preferred)
docker compose up -d postgres

# Full stack: Postgres + Kafka + Zookeeper
docker compose --profile kafka up -d

# Full stack: Postgres + Redis
docker compose --profile redis up -d

# Full stack: Everything (Postgres + Kafka + Redis)
docker compose --profile kafka --profile redis up -d

# Media ingest service (optional)
docker compose --profile media up -d

# Fabric network (LevelDB, lightweight)
cd fabric/network/docker
docker compose up -d

# Fabric network (with CouchDB for rich queries)
docker compose --profile couchdb up -d
```

---

## View & Debug

```bash
# List running containers
docker compose ps
docker ps --filter "label=com.docker.compose.project=roadwatch"

# View logs (all services)
docker compose logs -f

# View specific service logs
docker compose logs -f postgres
docker compose logs -f kafka
docker compose logs -f peer0.nhai.roadwatch.com

# Inspect container
docker inspect roadwatch_postgres
docker stats roadwatch_postgres

# Get into container (Postgres)
docker compose exec postgres bash
docker compose exec postgres psql -U postgres -d roadwatch -c "\l"

# View resource usage
docker stats
```

---

## Connect to Services

```bash
# Postgres
psql 127.0.0.1 5432

# Redis
redis-cli -h 127.0.0.1 -p 6379
PING  # verify connectivity

# Kafka (if local)
kafka-console-producer --broker-list localhost:9094 --topic test
kafka-console-consumer --bootstrap-server localhost:9094 --topic test

# Orderer health
curl -f http://127.0.0.1:8443/healthz

# Peer channel list
cd fabric/network
export CORE_PEER_LOCALMSPID=RoadWatchMSP
export CORE_PEER_ADDRESS=localhost:9051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=$(pwd)/organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=$(pwd)/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp
peer channel list
```

---

## Stop & Clean

```bash
# Stop all services (preserve volumes/data) — recommended default
docker compose stop

# Start them again in background
docker compose up -d

# To stop and remove containers + volumes (DESTRUCTIVE):
docker compose down --volumes

# Remove all stopped containers
docker container prune

# Remove unused images
docker image prune

# Full cleanup (careful!): removes images, containers, networks, volumes
docker system prune -a --volumes
```

---

## Port Reference

| Port | Service | Profile |
|------|---------|---------|
| 5432 | Postgres | default |
| 2181 | Zookeeper | kafka |
| 9094 | Kafka | kafka |
| 6379 | Redis | redis |
| 7050 | Fabric Orderer | - |
| 7051 | NHAI Peer | - |
| 7052 | NHAI Peer (CC) | - |
| 7054 | NHAI CA | - |
| 8054 | RoadWatch CA | - |
| 9051 | RoadWatch Peer | - |
| 9052 | RoadWatch Peer (CC) | - |
| 5984 | CouchDB (NHAI) | couchdb |
| 15984 | CouchDB (RW) | couchdb |
| 3000 | Gateway API | (manual run) |
| 5173 | Frontend | (manual run) |

---

## Env File Checklist

```bash
# Copy templates
cp apps/gateway-api/.env.example apps/gateway-api/.env
cp docker/.env.example docker/.env
cp services/fabric-anchor-consumer/.env.example services/fabric-anchor-consumer/.env

# Fill required fields
REQUIRED for Gateway API (Postgres preferred):
  - DATABASE_URL (point to PgBouncer-backed pooled endpoint)
  - JWT_SECRET (any random string)
  - ALLOW_DEV_OTP_ECHO=true

OPTIONAL:
  - GEMINI_API_KEY (get from aistudio.google.com)
  - KAFKA_BROKER (if running local Kafka)
  - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_BUCKET (for media uploads)
```

---

## Health Checks

```bash
# Postgres
docker compose exec postgres psql -U postgres -d roadwatch -c 'SELECT NOW();'

# Redis
docker compose exec redis redis-cli ping

# Kafka
docker compose exec kafka kafka-broker-api-versions.sh --bootstrap-server localhost:9092

# Fabric Orderer
curl http://127.0.0.1:8443/healthz

# Fabric Peers
cd fabric/network/docker
docker compose exec peer0.nhai.roadwatch.com peer channel list
docker compose exec peer0.roadwatch.roadwatch.com peer channel list
```

---

## Troubleshooting

| Issue | Quick Fix |
|-------|-----------|
| "Port already in use" | `lsof -i :PORT` then `kill -9 PID` |
| Container won't start | `docker compose logs SERVICE_NAME` |
| Permission denied | Likely Docker socket issue; check perms |
| Out of memory | Reduce `deploy.resources.limits.memory` |
| Can't connect to DB | Verify container is healthy: `docker compose ps` |
| Fabric scripts fail | Ensure you're in `fabric/network/` directory |
| CouchDB won't start | Enable via profile: `--profile couchdb` |
| Peers not joining channel | Check orderer logs; may have failed startup |

---

## Memory Usage

```bash
# Check total memory
docker stats --no-stream

# Expected per configuration:
# Postgres only         ~256 MB
# Postgres + Kafka      ~768 MB
# Fabric (LevelDB)      ~1.5 GB
# Fabric + CouchDB      ~2 GB
# All services          ~2.3 GB
```

---

## Volume Management

```bash
# List volumes
docker volume ls | grep roadwatch

# Inspect volume
docker volume inspect postgres_data

# Backup Postgres data
docker run --rm -v postgres_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres_backup.tar.gz -C /data .

# Restore Postgres data
docker volume rm postgres_data
docker volume create postgres_data
docker run --rm -v postgres_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/postgres_backup.tar.gz -C /data
```

---

## Network Connectivity

```bash
# Test internal network connectivity
docker compose exec postgres bash
  ping kafka        # if kafka profile enabled
  ping redis        # if redis profile enabled

# Test from Fabric network
cd fabric/network/docker
docker compose exec peer0.nhai.roadwatch.com bash
  ping orderer1.orderer.roadwatch.com
  curl ca.nhai.roadwatch.com:7054/healthz
```

---

## Useful Commands

```bash
# Get exact container name
docker ps --format "table {{.Names}}\t{{.Status}}"

# Copy file to container
docker cp myfile.txt roadwatch_postgres:/tmp/

# Copy file from container
docker cp roadwatch_postgres:/tmp/myfile.txt .

# Run one-off command in container
docker compose exec postgres ls -la /var/lib/postgresql/data

# View container IP
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' roadwatch_postgres

# Get environment variables
docker inspect roadwatch_postgres | grep -A 30 '"Env"'
```

---

## Useful Docker Compose Flags

```bash
# Run in foreground (see logs)
docker compose up

# Run in background
docker compose up -d

# With profile
docker compose --profile kafka up

# Multiple profiles
docker compose --profile kafka --profile redis up

# Specific service
docker compose up postgres

# Recommended: stop containers (preserves volumes/data)
# docker compose stop

# Remove containers and volumes (DESTRUCTIVE):
docker compose down --volumes

# Scale service (if supported)
docker compose up -d --scale kafka=2

# Build images
docker compose build

# Pull latest images
docker compose pull
```

---

## Fabric Specific

```bash
# Start Fabric network (non-destructive)
cd fabric/network/docker
docker compose stop || true
cd ..
./scripts/start.sh

# To force a full reset (remove containers/volumes/artifacts), use the explicit reset flag
cd fabric/network
./scripts/start.sh --reset

# Redeploy chaincode
./scripts/deploy-chaincode.sh

# Invoke transaction
peer chaincode invoke \
  -C roadwatch-india \
  -n complaint-anchor \
  -c '{"function":"CreateComplaint","Args":["..."]}'

# Query ledger
peer chaincode query \
  -C roadwatch-india \
  -n complaint-anchor \
  -c '{"Args":["GetComplaintHistory","COMPLAINT_ID"]}'
```

---

**Last Updated:** May 8, 2026  
**Print me! 🖨️**
