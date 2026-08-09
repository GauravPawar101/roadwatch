# RoadWatch Deployment Router

> Full guide: [docs/operations/deployment.md](../../docs/operations/deployment.md)

Deploy **where** (target tool) and **what** (layer subset). Kubernetes manifests are **district-agnostic** — state/national boundaries are handled in application data, not infra.

```powershell
.\ops\deploy\deploy.ps1 -Target <local|kind|k8s|aws> [flags]
```

For cloud cost tiers and service choices, see **[CLOUD.md](./CLOUD.md)**.

---

## Targets (where)

| Target | Tool | Use when |
|--------|------|----------|
| `local` | Docker Compose | Fast dev on laptop, no Kubernetes |
| `kind` | kind + kubectl | Full stack locally in Kubernetes |
| `k8s` | kubectl (existing cluster) | EKS, GKE, AKS, on-prem |
| `aws` | AWS CLI + kubectl | EKS with managed RDS/MSK/Redis |

---

## Layer flags (what)

RoadWatch is split into layers. Deploy all or a subset:

| Layer | Contents |
|-------|----------|
| `0` | Postgres, PgBouncer, Redis, ConfigMaps, Secrets |
| `1` | gateway-api, backend-api |
| `2` | Kafka (HLF + events), webhook-handler, fabric-anchor |
| `3` | scheduler |
| `4` | frontend |

| Flag | Effect |
|------|--------|
| *(default)* | Full stack (`kubectl apply -k k8s/overlays/{dev\|prod}`) |
| `-Layer 0` | Platform only |
| `-Layer 2` | Kafka (+ consumers if app images present) |
| `-InfraOnly` | Layers 0 + 2, no app pods |
| `-SkipAppImages` | Config/infra only, skip Deployments that need local images |
| `-Environment dev\|prod` | Overlay: log level, resource limits, `FABRIC_HOST_IP` |
| `-WaitReady` | Wait for critical pods |
| `-DryRun` | Print manifests, don't apply |

### Examples

```powershell
# Full local Kubernetes stack
.\ops\deploy\deploy.ps1 -Target kind

# Platform + Kafka only (cheapest smoke test)
.\ops\deploy\deploy.ps1 -Target kind -InfraOnly

# Add API layer to existing cluster
.\ops\deploy\deploy.ps1 -Target k8s -Layer 1

# Prod overlay on existing EKS context
.\ops\deploy\deploy.ps1 -Target k8s -Environment prod

# Direct script (same as k8s target)
.\k8s\deploy.ps1 -Layer 0 -Environment dev
```

---

## Configuration

All k8s config is in **ConfigMaps and Secrets** under `k8s/base/` and `k8s/overlays/{dev,prod,aws}/`. No `.env` files for cluster deploys.

| Resource | File |
|----------|------|
| `infra-config` | `k8s/base/layer-0-platform/configmap-infra.yaml` |
| `app-config` | `k8s/base/layer-0-platform/configmap-app.yaml` |
| `cluster-config` | `k8s/base/layer-0-platform/configmap-cluster.yaml` (`FABRIC_HOST_IP`) |
| `app-secrets` | `k8s/base/layer-0-platform/secret.yaml` (dev placeholders) |
| `fabric-certs` | Created at deploy from Fabric network files |

`-DistrictCode` is **optional** and only affects **local** demo seeding (`-Target local -StartApps`). It does not change k8s manifests.

---

## kind-specific flags

| Flag | Purpose |
|------|---------|
| `-Reset` | Delete and recreate kind cluster |
| `-SkipBuild` | Use cached Docker images |
| `-SkipFabricCerts` | Skip `fabric-certs` Secret |

**Endpoints:** Frontend `:30080`, Gateway `:30100`, Backend `:30401`

---

## AWS

```powershell
$env:AWS_REGION = "ap-south-1"
$env:EKS_CLUSTER_NAME = "roadwatch"
.\ops\deploy\deploy.ps1 -Target aws -Environment prod
```

Edit `k8s/overlays/aws/configmap-infra-patch.yaml` with your RDS, ElastiCache, and MSK endpoints before applying.
