# Kubernetes Architecture

Kubernetes manifests use a **layer-based Kustomize** layout. Each layer maps to a distinct architectural role.

## Layer model

```
Layer 0 — PLATFORM        postgres, pgbouncer, redis, configmaps, secrets
Layer 1 — INGEST/API      gateway-api, backend-api
Layer 2 — INGEST.HLF      kafka-hlf, kafka-events, webhook-handler, fabric-anchor
Layer 3 — SCHEDULE        scheduler (StatefulSet, replicas=1)
Layer 4 — PRESENTATION    frontend (nginx static)
Layer 5 — HLF NETWORK     Fabric peers/orderer (external, on Docker host)
```

## Directory layout

```
k8s/
  kind-config.yaml              # NodePort mappings
  deploy.ps1                    # Layer-by-layer apply
  base/
    kustomization.yaml
    layer-0-platform/           # Postgres, PgBouncer, Redis
    layer-1-ingest-api/           # gateway-api, backend-api
    layer-2-ingest-hlf/           # Kafka clusters, consumers
    layer-3-schedule/             # scheduler
    layer-4-presentation/         # frontend
  overlays/
    dev/                          # Dev patches, FABRIC_HOST_IP
    prod/                         # Resource limits, HPA minReplicas=2
    aws/                          # AWS managed-service patches
```

## StatefulSet vs Deployment

| Component | Type | Reason |
|-----------|------|--------|
| postgres | StatefulSet | Data persistence, stable hostname |
| redis | StatefulSet | Session/OTP state survives restarts |
| zookeeper-hlf, zookeeper-events | StatefulSet | Kafka metadata per cluster |
| kafka-hlf, kafka-events | StatefulSet | Prevent stale-IP controller loops |
| scheduler | StatefulSet (replicas=1) | Prevent duplicate cron execution |
| gateway-api, backend-api | Deployment + HPA | Horizontally scalable |
| webhook-handler, fabric-anchor | Deployment | Stateless consumers |
| frontend | Deployment | Static nginx bundle |

## Kind host ports

| Service | Host | NodePort |
|---------|------|----------|
| Frontend | 8080 | 30080 |
| Gateway | 3100 | 30100 |
| Backend | 4001 | 30401 |

## Deploy commands

```powershell
# Full Kind cluster + all layers
pnpm k8s:up
# or
.\ops\deploy\deploy.ps1 -Target kind

# Layer by layer
.\k8s\deploy.ps1 -Layer 0    # Platform only
.\k8s\deploy.ps1 -Layer 2    # Kafka + consumers

# Tear down
pnpm k8s:down                # Delete Kind cluster
pnpm k8s:reset               # Reset and redeploy
```

## ConfigMaps and Secrets

| Resource | Contents |
|----------|----------|
| `infra-config` | Database hosts, Kafka brokers, Redis URL |
| `app-config` | App-level settings (ports, feature flags) |
| `cluster-config` | Cluster-specific overrides |
| `app-secrets` | JWT secrets, API keys (dev placeholders in `secret.yaml`) |
| `fabric-certs` | Fabric MSP certificates (runtime, from crypto material) |
| `fabric-config` | Channel name, chaincode name, peer endpoints |

## Fabric external access

Fabric peers run on the Docker host, not inside Kind. The `fabric-anchor` pod uses:

- `hostAliases` to resolve peer DNS names to `FABRIC_HOST_IP`
- `fabric-certs` Secret mounted at `/fabric/`
- gRPC to `peer0.nhai.roadwatch.com:17051` and `peer0.roadwatch.roadwatch.com:19051`

`deploy-kind.ps1` injects `FABRIC_HOST_IP` from the host machine's IP.

## Overlays

| Overlay | Changes |
|---------|---------|
| `dev` | Lower resource limits, dev secrets, FABRIC_HOST_IP substitution |
| `prod` | HPA minReplicas=2, production resource limits |
| `aws` | Patches for EKS managed Postgres, ElastiCache, MSK |

## Related docs

- [Deployment](../operations/deployment.md)
- [Fabric network](./fabric-network.md)
- [k8s/README.md](../../k8s/README.md) — quick reference in the k8s folder
