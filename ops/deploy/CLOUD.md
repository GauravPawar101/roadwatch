# RoadWatch — Cheapest Cloud Deployment Plan

RoadWatch infra is **one stack per deployment** (state, region, or national). Geographic scope is modeled in **Postgres data** (districts, roads, complaints), not in Kubernetes overlays.

This document maps each component to the cheapest viable managed option on AWS (ap-south-1 Mumbai as reference). Adjust region for data residency.

---

## Tier comparison

| Tier | Monthly est. (low traffic) | Best for |
|------|---------------------------|----------|
| **A — Dev / pilot** | ~$80–150 | Single district pilot, &lt;1k complaints/day |
| **B — State** | ~$400–900 | One state, managed HA, &lt;50k complaints/day |
| **C — National** | ~$3k–15k+ | Multi-region, HA everything, Fabric peers per org |

Estimates assume reserved/savings-plan pricing where noted, single region, no idle GPU.

---

## Tier A — Dev / pilot (cheapest)

**Goal:** Run full stack with minimal ops. Accept single-AZ and smaller instances.

| Component | Service | Sizing | Why |
|-----------|---------|--------|-----|
| Compute | **EKS** on **Fargate** or 1× `t3.medium` node group | 2 vCPU / 4 GB | Fargate avoids node management; for always-on dev, one small EC2 node is often cheaper |
| Postgres | **RDS PostgreSQL** `db.t4g.micro` | 20 GB gp3 | Cheapest managed Postgres; use PgBouncer in-cluster or RDS Proxy only if needed |
| Redis | **ElastiCache** `cache.t4g.micro` | 1 node | Idempotency + gateway cache; skip cluster mode |
| Kafka | **In-cluster** (Strimzi on EKS) OR **MSK** `kafka.t3.small` × 2 | 2 brokers min for MSK | MSK adds ~$70+/mo; in-cluster Kafka is cheaper but you operate it |
| Object storage | **S3** | Standard | Media uploads (replace Supabase storage in prod) |
| Frontend | **S3 + CloudFront** | — | Static Vite build; no nginx pod required |
| Ingress | **ALB** (AWS Load Balancer Controller) | 1 ALB | Single entry for gateway-api |
| Secrets | **Secrets Manager** or **SSM Parameter Store** | — | `app-secrets`, `fabric-certs`; SSM is cheaper |
| Fabric HLF | **EC2** `t3.medium` × 1–2 peers | Docker Compose or k8s | Not on Fargate; peers need persistent disk |

**Deploy:**

```powershell
# 1. Provision Tier A (Terraform/CDK — not in repo yet)
#    EKS cluster, RDS, ElastiCache, S3, ALB

# 2. Patch endpoints
#    Edit k8s/overlays/aws/configmap-infra-patch.yaml

# 3. Create secrets in cluster
kubectl create secret generic app-secrets --from-literal=POSTGRES_PASSWORD=... -n roadwatch

# 4. Apply
$env:AWS_REGION = "ap-south-1"
$env:EKS_CLUSTER_NAME = "roadwatch-pilot"
.\ops\deploy\deploy.ps1 -Target aws -Environment dev
```

**Cost savers:**
- Use **one** Kafka cluster in-cluster instead of dual MSK clusters until HLF volume justifies split
- Run **scheduler + webhook** as single-replica Deployments (already default)
- Scale gateway HPA `minReplicas: 1` in dev overlay
- Frontend on CloudFront, not EKS layer 4

---

## Tier B — State production

**Goal:** HA for data plane, autoscaling API, separate Kafka for HLF backpressure.

| Component | Service | Sizing |
|-----------|---------|--------|
| Compute | EKS managed node group | 2× `m6g.large` across 2 AZs |
| Postgres | RDS PostgreSQL Multi-AZ | `db.r6g.large`, 100 GB gp3 |
| Redis | ElastiCache replication group | `cache.r6g.large`, 2 nodes |
| Kafka HLF | MSK cluster | `kafka.m5.large` × 2 brokers |
| Kafka Events | MSK cluster (or Confluent Cloud pay-go) | `kafka.m5.large` × 2 |
| Media | S3 + CloudFront | Lifecycle to Glacier after 90d |
| Monitoring | CloudWatch + Container Insights | Basic alarms on RDS CPU, MSK lag |
| Fabric | Dedicated EC2 or separate EKS node pool | 3 orgs × 2 peers |

**Deploy sequence:**

```powershell
# Infra first (Terraform)
.\ops\deploy\deploy.ps1 -Target k8s -Environment prod -InfraOnly
# Verify Postgres, Redis, Kafka reachable from cluster

# Apps
.\ops\deploy\deploy.ps1 -Target k8s -Environment prod -Layer 1 -WaitReady
.\ops\deploy\deploy.ps1 -Target k8s -Environment prod -Layer 2
.\ops\deploy\deploy.ps1 -Target k8s -Environment prod -Layer 3
# Frontend → CloudFront (skip layer 4 in cluster)
```

**Cost savers:**
- **Graviton** (`m6g`, `r6g`, `t4g`) — ~20% cheaper than x86
- **RDS Reserved Instances** 1-year — ~35% off
- **S3 Intelligent-Tiering** for complaint photos
- Dual Kafka only when fabric-anchor lag &gt; SLA; otherwise single MSK + topic prefixes

---

## Tier C — National

**Goal:** Multi-region read replicas, DR, org-separated Fabric channels.

| Component | Approach |
|-----------|----------|
| Postgres | RDS primary (region A) + read replicas per region; routing via PgBouncer or RDS Proxy |
| Redis | ElastiCache Global Datastore or per-region clusters |
| Kafka | MSK per region; MirrorMaker 2 for cross-region topics |
| API | EKS per region, gateway HPA 2–10, backend 2–4 |
| Fabric | Channel per state/org; orderers on dedicated hosts |
| CDN | CloudFront with India edge locations |

National scope is still **one codebase, one manifest set** — scale by replica count and managed service size, not per-state k8s overlays.

---

## What NOT to put in Kubernetes

| Concern | Cheaper / simpler alternative |
|---------|-------------------------------|
| District / state config | Postgres `districts` table + app config |
| Static frontend | S3 + CloudFront |
| Postgres | RDS (never run StatefulSet Postgres in prod) |
| Kafka at scale | MSK or Confluent Cloud |
| Secrets in git | Secrets Manager / External Secrets Operator |
| Fabric peers | EC2 with EBS, not serverless |

---

## Component → layer mapping

Use deploy layer flags to roll out incrementally on any cloud:

```
Layer 0  → RDS + ElastiCache endpoints in infra-config
Layer 2  → MSK brokers (or in-cluster Kafka for pilot)
Layer 1  → gateway + backend (behind ALB)
Layer 2b → webhook + fabric-anchor consumers
Layer 3  → scheduler (single replica)
Layer 4  → optional; prefer CloudFront for frontend
```

---

## Next steps (recommended order)

1. **Pilot (Tier A):** EKS + RDS micro + in-cluster Kafka + S3 frontend — validate one district in data
2. **Harden:** Move secrets to Secrets Manager, enable RDS backups, MSK instead of in-cluster Kafka
3. **Scale (Tier B):** Multi-AZ, dual Kafka, HPA tuning, Fabric on dedicated nodes
4. **National (Tier C):** Read replicas, multi-region EKS, MSK mirroring — only when traffic requires it

---

## Files to edit per cloud

| File | What to set |
|------|-------------|
| `k8s/overlays/aws/configmap-infra-patch.yaml` | RDS host, ElastiCache, MSK broker URLs |
| `k8s/overlays/prod/configmap-cluster-patch.yaml` | `FABRIC_HOST_IP` or peer LB hostname |
| `k8s/overlays/prod/configmap-app-patch.yaml` | `CORS_ORIGINS`, `LOG_LEVEL` |
| Cluster secrets (not in git) | `POSTGRES_PASSWORD`, `JWT_SECRET`, Supabase/S3 keys |

No per-state or per-district Kubernetes overlays are required.
