# 🐳 RoadWatch Docker Setup Guide

## Overview

All docker-compose files have been rewritten for **lightweight operation** and to remove common port conflicts on developer machines.
This repo now centralizes host port mappings in a single `.env` and uses a consistent container-naming convention `roadwatch_servicename` so containers are predictable and easier to manage.

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

Note: Host port values are now defined in the repository root `.env` (see `TOP_*` and `MEDIA_*` variables). Default mappings have been chosen to avoid collisions with locally installed DBs and services. Example mappings (defaults):
- `TOP_POSTGRES_HOST_PORT` -> container `5432` (default 5433)
- `TOP_PGBOUNCER_HOST_PORT` -> container `6432` (default 16432)
- `TOP_ZOOKEEPER_HOST_PORT` -> container `2181` (default 2181)
- `TOP_KAFKA_HOST_PORT` -> container `9094` (default 9094)
- `TOP_REDIS_HOST_PORT` -> container `6379` (default 16379)

Per-service stacks (e.g. `services/media-ingest`) have their own `MEDIA_*` defaults. You can override any value in `.env` before starting the stacks.

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
| Peer images | hyperledger/fabric-peer:2.5.15 | hyperledger/fabric-peer:2.5.15-alpine |
| Orderer images | hyperledger/fabric-orderer:2.5.15 | hyperledger/fabric-orderer:2.5.15-alpine |
| CouchDB | ❌ Always enabled (heavy) | ✅ Optional profile (goleveldb default) |
| CouchDB image | couchdb:3.3.2 | couchdb:3.3.2-alpine |
| Peer state DB | CouchDB | LevelDB (goleveldb) — 10x lighter |
| Resource limits | ❌ None | ✅ All services limited |
| Health checks | ❌ None | ✅ All critical services checked |
| Restart policy | ❌ None | ✅ unless-stopped |
| Volume perms | ❌ RW | ✅ Read-only where safe |
| Metrics | Enabled | Disabled (saves memory) |

These Fabric ports are still configured in `fabric/network/.env`. They follow the `roadwatch_servicename` convention and are namespaced under the Fabric compose project. If you prefer to also manage Fabric ports from the repo root `.env`, see the final section "Include Fabric ports in root .env".

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
Make sure you have the repo root `.env` populated (default values are included). Docker Compose will automatically read `.env` from the repository root.

Start the top-level stack (reads `TOP_*` values):
```powershell
docker compose up -d postgres
```

# 2. Verify Postgres is ready
docker compose exec postgres pg_isready -U roadwatch_admin

# 3. Start Fabric network (separate terminal)
Fabric uses `fabric/network/.env` by default. Run from that folder to respect Fabric-specific variables:
```powershell
cd fabric/network
docker compose --env-file .env up -d
```

# 4. Verify Fabric is ready
docker compose logs -f peer0.nhai.roadwatch.com | grep "Starting peer"

# 5. List all running containers (project-scoped)
Use a predictable compose project name to keep container names stable (recommended):
```powershell
docker compose --project-name roadwatch ps
```

Or list by the repo naming convention:
```powershell
docker ps --filter "name=roadwatch_"
```

---

## Naming & Port-management notes

- Container names: we use `roadwatch_<servicename>` (or `roadwatch_servicename` in Fabric envs) for infra services that are singletons (databases, pgbouncer, fabric peers). Application services keep Compose-generated names (prefixed by project) unless a stable singleton is required.
- Centralized ports: change host ports by editing `.env` at the repository root. Example: set `MEDIA_POSTGRES_HOST_PORT=15432` to move the media stack Postgres host port.
- Avoid publishing DB ports to host unless you need to connect from your host. Prefer to access DBs via service hostnames on the Docker network (e.g., `postgres:5432` or `pgbouncer:6432`).

If you want me to move Fabric port variables into the repo root `.env`, reply "include fabric" and I'll centralize them and update `fabric/network/.env` to read from the root file.
```

---

## Multi‑Host / Production Deployment

This repository's Compose files are optimized for local development (bridge networks, convenience `container_name` values, and host port overrides). For deploying services to different servers (one service per host) you must not assume the same local docker-compose behavior — follow the checklist and recommendations below.

- Top-level guidance:
  - Use an orchestrator for multi-host: **Docker Swarm** (simple) or **Kubernetes** (recommended for production). Plain `docker compose` does not create multi-host networks.
  - Replace bridge networks with overlay networks when using Swarm, or translate Compose to Kubernetes manifests/Helm charts for K8s.
  - Avoid publishing internal-only ports to host unless the service must be reachable from outside the host. Prefer service discovery inside the orchestrator.

- Networks:
  - Local dev: keep `driver: bridge`. These networks are host-local and cannot route across servers.
  - Swarm: create an **overlay** network and mark it `external: true` in your stack file so each host attaches to the same network. Example:

```yaml
networks:
  roadwatch:
    external: true
```

  - Kubernetes: use `Service` objects (ClusterIP, NodePort, LoadBalancer) and let K8s handle networking.

- Container names & scaling:
  - `container_name` makes container names predictable but prevents scaling and can cause name collisions. For multi‑host deployments prefer the orchestrator's service naming and remove `container_name` entries from production manifests.

- Ports & exposure checklist (per host):
  - Expose only ports required by external clients (APIs, admin portals). Internal services (Postgres, Redis, Kafka internals) should be reachable via the overlay/network and not bound to the host.
  - Use NodePort/LoadBalancer (K8s) or published ports on a specific gateway host for external access.
  - When mapping host ports, use the centralized `.env` to keep mappings consistent; on different servers the same host port can be reused because hosts are independent, but avoid scheduling multiple services that publish the same host port on the same host.

- Example: Docker Swarm steps
  1. Initialize Swarm on manager: `docker swarm init --advertise-addr <MANAGER_IP>`
  2. Create overlay: `docker network create -d overlay roadwatch`
  3. Join workers with the token from `docker swarm join-token worker`.
  4. Deploy stack (remove `container_name` for production):

```powershell
docker stack deploy --compose-file docker-compose.yml roadwatch
```

  5. Verify placement: `docker service ls` and `docker service ps <service>`.

- Example: Kubernetes notes
  - Convert Compose to K8s manifests (tools: Kompose, compose2k8s) or write Helm charts.
  - Use `Deployment` + `Service` for each component and an Ingress controller for HTTP traffic.

- Firewall & host OS
  - Open required TCP ports only. For example, open backend API ports on hosts running APIs, and open Fabric ports only on hosts that need to communicate externally.

- Validation checklist before go‑live:
  - [ ] Overlay network exists on all nodes and services join it.
  - [ ] `container_name` removed from production manifests or names are unique per host.
  - [ ] Only externally required ports are exposed via LoadBalancer/Ingress or published ports.
  - [ ] No two services scheduled to the same host publish the same host port.
  - [ ] Services are running on intended hosts (`docker service ps` / `kubectl get pods`).

If you want, I can:
 - generate a Swarm-ready version of the top-level Compose (overlay network + removed `container_name`) and a short script to create the overlay network; OR
 - generate Kubernetes manifests (Deployment + Service) for a subset of services (e.g., `postgres`, `pgbouncer`, `gateway-api`) so you can review the multi-host setup.

---

**Last Updated:** May 8, 2026  
**Maintained by:** RoadWatch Development Team
