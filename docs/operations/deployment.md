# Deployment

Deploy RoadWatch to local Docker, Kind (local k8s), existing Kubernetes, or AWS.

## Deploy router

All deployment goes through `ops/deploy/deploy.ps1`:

```powershell
pnpm deploy                    # Interactive router
pnpm deploy:local              # Docker Compose local
pnpm deploy:local:apps         # Apps only, skip Fabric
pnpm deploy:kind               # Kind cluster
pnpm deploy:k8s                # Existing k8s cluster
pnpm deploy:aws                # AWS/EKS
```

## Local Docker

```powershell
pnpm deploy:local
# or manually:
docker compose up -d
pnpm dev
```

Deploys infrastructure containers. Application servers run as local Node processes.

## Kind (local Kubernetes)

```powershell
pnpm k8s:up
# equivalent to:
.\ops\deploy\deploy.ps1 -Target kind
```

This:

1. Creates a Kind cluster (`roadwatch`) with NodePort mappings
2. Builds and loads Docker images
3. Applies k8s manifests layer by layer
4. Injects `FABRIC_HOST_IP` for Fabric peer access

### Layer-by-layer deploy

```powershell
.\k8s\deploy.ps1 -Layer 0    # Platform (Postgres, Redis)
.\k8s\deploy.ps1 -Layer 1    # API (gateway, backend)
.\k8s\deploy.ps1 -Layer 2    # Kafka + consumers
.\k8s\deploy.ps1 -Layer 3    # Scheduler
.\k8s\deploy.ps1 -Layer 4    # Frontend
```

### Kind host ports

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Gateway | http://localhost:3100 |
| Backend | http://localhost:4001 |

### Tear down

```powershell
pnpm k8s:down      # Delete Kind cluster
pnpm k8s:reset     # Reset and redeploy
```

## Existing Kubernetes

```powershell
pnpm deploy:k8s
# or:
.\ops\deploy\deploy.ps1 -Target k8s
```

Applies manifests to the current kubectl context. Ensure secrets and ConfigMaps are configured for your environment.

## AWS / EKS

```powershell
pnpm deploy:aws
```

Uses the `k8s/overlays/aws/` overlay for managed Postgres, ElastiCache, and MSK patches. See `ops/deploy/CLOUD.md` for cloud-specific configuration.

## Fabric in deployment

Fabric runs **outside** k8s on the Docker host. Before deploying Layer 2:

1. Start Fabric network: `pnpm fabric:start`
2. Deploy chaincode: `pnpm fabric:deploy`
3. Ensure `fabric-certs` Secret is populated with crypto material

## Environment-specific overlays

| Overlay | Path | Purpose |
|---------|------|---------|
| dev | `k8s/overlays/dev/` | Lower limits, dev secrets |
| prod | `k8s/overlays/prod/` | HPA minReplicas=2, production limits |
| aws | `k8s/overlays/aws/` | Managed service patches |

## Pre-deployment checklist

- [ ] Environment files configured (see [Environment variables](../getting-started/environment-variables.md))
- [ ] Docker images built (`pnpm build`)
- [ ] Secrets created (JWT, database, Fabric certs)
- [ ] Kafka topics initialized (`scripts/init-messaging.ps1`)
- [ ] Database seeded (`pnpm seed:demo`) for demo environments
- [ ] Fabric network running (if anchoring enabled)

## Related docs

- [Kubernetes architecture](../architecture/kubernetes.md)
- [Docker Compose](../infrastructure/docker-compose.md)
- [Fabric deployment](../infrastructure/fabric-deployment.md)
- [ops/deploy/README.md](../../ops/deploy/README.md)
- [ops/deploy/CLOUD.md](../../ops/deploy/CLOUD.md)
