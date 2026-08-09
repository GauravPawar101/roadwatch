# Infrastructure

Operational infrastructure for RoadWatch: containers, messaging, database, and blockchain.

| Topic | Doc |
|-------|-----|
| Docker Compose | [docker-compose.md](./docker-compose.md) |
| Fabric deployment | [fabric-deployment.md](./fabric-deployment.md) |
| Kafka and Redis | [messaging.md](./messaging.md) |
| Database | [database.md](./database.md) |

## Quick start

```powershell
docker compose up -d          # Start all infrastructure
pnpm seed:demo                # Seed demo data
pnpm dev                      # Start application servers
```

## Architecture layers

See [Architecture overview](../architecture/overview.md) for the full system diagram.

For Kubernetes deployment, see [Kubernetes architecture](../architecture/kubernetes.md) and [Deployment](../operations/deployment.md).
