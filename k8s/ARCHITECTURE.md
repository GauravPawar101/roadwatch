# RoadWatch Kubernetes Architecture

> Canonical doc: [docs/architecture/kubernetes.md](../docs/architecture/kubernetes.md)

Manifests are organised by **logical layer** — each layer maps to a distinct
architectural role and data lifecycle. Stateful components use `StatefulSet` with
stable DNS hostnames and PVCs. Stateless components use `Deployment`.

---

## Layer Model

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 0 — PLATFORM / STORAGE                                       │
│  Pure persistence. No business logic. StatefulSets + PVCs.          │
│                                                                     │
│  postgres   (StatefulSet)   canonical source of truth               │
│  pgbouncer  (Deployment)    stateless connection pooler             │
│  redis      (StatefulSet)   sessions / OTP cache / idempotency keys │
│                                                                     │
│  namespace: roadwatch                                               │
│  layer label: platform                                              │
│  manifests: k8s/base/layer-0-platform/                              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ read/write via PgBouncer:6432
┌───────────────────────────▼─────────────────────────────────────────┐
│  LAYER 1 — INGEST / API                                             │
│  Receives citizen events, validates, persists to Postgres,          │
│  publishes to Kafka. Stateless — scales horizontally via HPA.       │
│                                                                     │
│  gateway-api  (Deployment + HPA)  JWT auth, routing, event outbox  │
│  backend-api  (Deployment + HPA)  internal data API                │
│                                                                     │
│  namespace: roadwatch                                               │
│  layer label: ingest-api                                            │
│  manifests: k8s/base/layer-1-ingest-api/                            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ publishes to kafka-hlf + kafka-events
┌───────────────────────────▼─────────────────────────────────────────┐
│  LAYER 2 — INGEST.HLF                                               │
│  Backpressure buffer between fast DB writes (1000s events/s)        │
│  and slow HLF commits (10–100 tx/s). StatefulSets prevent the       │
│  stale-IP controller loop that Deployments cause.                   │
│                                                                     │
│  zookeeper-hlf       (StatefulSet)  HLF Kafka metadata              │
│  kafka-hlf           (StatefulSet)  HLF backpressure buffer         │
│  zookeeper-events    (StatefulSet)  operational Kafka metadata      │
│  kafka-events        (StatefulSet)  SLA / triggers / notifications  │
│  webhook-handler     (Deployment)   kafka-events → DB fan-out       │
│  fabric-anchor       (Deployment)   kafka-hlf → HLF Merkle batching │
│                                                                     │
│  namespace: roadwatch                                               │
│  layer label: ingest-hlf                                            │
│  manifests: k8s/base/layer-2-ingest-hlf/                            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ anchored Merkle roots via gRPC
┌───────────────────────────▼─────────────────────────────────────────┐
│  LAYER 3 — SCHEDULE                                                 │
│  Time-triggered cron worker. Reacts to DB state, not inbound events.│
│  StatefulSet with replicas=1 — a Deployment with replicas>1 would  │
│  double-fire every cron job.                                        │
│                                                                     │
│  scheduler  (StatefulSet, replicas=1)  karma/SLA/audit/report crons │
│                                                                     │
│  namespace: roadwatch                                               │
│  layer label: schedule                                              │
│  manifests: k8s/base/layer-3-schedule/                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 4 — PRESENTATION                                             │
│  Stateless nginx bundle. VITE_API_BASE baked in at build time.      │
│                                                                     │
│  frontend  (Deployment)  static nginx                               │
│                                                                     │
│  namespace: roadwatch                                               │
│  layer label: presentation                                          │
│  manifests: k8s/base/layer-4-presentation/                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — HLF NETWORK  (external — outside k8s)                    │
│  Hyperledger Fabric peers, orderer, and CAs run on the Docker host. │
│  Reached from inside kind via hostAliases (FABRIC_HOST_IP injected  │
│  by deploy-kind.ps1) + fabric-certs Secret mounted at /fabric/.     │
│                                                                     │
│  peer0.nhai.roadwatch.com:17051        (Docker host)               │
│  peer0.roadwatch.roadwatch.com:19051   (Docker host)               │
│  orderer1.orderer.roadwatch.com:17050  (Docker host)               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## StatefulSet vs Deployment

| Component | Type | Reason |
|-----------|------|--------|
| `postgres` | **StatefulSet** | Data must survive restarts. Stable hostname for PgBouncer and replicas. |
| `redis` | **StatefulSet** | Loses sessions/OTP/rate-limiter state on restart → auth failures. |
| `zookeeper-hlf` / `zookeeper-events` | **StatefulSet** | Kafka metadata per cluster. Loss = that cluster unusable. |
| `kafka-hlf` / `kafka-events` | **StatefulSet** | Stable `ADVERTISED_LISTENERS` DNS — prevents stale-broker-IP loop. |
| `scheduler` | **StatefulSet** | `replicas=1` must be enforced. Double instances = double cron fires. |
| `pgbouncer` | Deployment | Stateless. No local data. Safe to restart anytime. |
| `gateway-api` | Deployment + HPA | Stateless HTTP. All state in Postgres + Redis. |
| `backend-api` | Deployment + HPA | Stateless HTTP. All state in Postgres + Redis. |
| `webhook-handler` | Deployment | Stateless Kafka consumer. Commits offsets to Kafka, writes to Postgres. |
| `fabric-anchor` | Deployment | Stateless Kafka consumer. Commits offsets to Kafka, writes to Postgres. |
| `frontend` | Deployment | Static nginx. Rebuilt on every deploy. |

---

## Why Two Kafka Clusters in `layer-2-ingest-hlf`

RoadWatch runs **two independent Kafka clusters** — each with its own Zookeeper
ensemble — because they serve different throughput profiles:

### `kafka-hlf` — HLF backpressure buffer

- **Purpose:** absorb the gap between fast ingest (~1000s events/s) and slow
  Fabric commits (~10–100 tx/s)
- **Consumer:** `fabric-anchor` only
- **Topics:** `complaint-submitted`, `complaint-status-changed`, `dlq-events`
- **Service:** `kafka-hlf:29092`

### `kafka-events` — operational event bus

- **Purpose:** SLA checks, notifications, authority actions, triggers, webhook fan-out
- **Consumer:** `webhook-handler` (primary)
- **Topics:** `notification-send`, `authority-action`, `escalation-due`,
  `complaint-anchored`, media topics, etc.
- **Service:** `kafka-events:29092`

### Dual-publish topics

`complaint-submitted` and `complaint-status-changed` are published to **both**
clusters by `gateway-api` / `backend-api` so HLF anchoring and operational
consumers stay decoupled.

`fabric-anchor` reads from `kafka-hlf` and writes `complaint-anchored` /
`notification-send` to `kafka-events`.

Neither cluster lives in `layer-0-platform` — they are pipeline-specific, not
general-purpose infra.

---

## DNS Naming

### StatefulSet pods
```
<name>-<ordinal>.<headless-service>.<namespace>.svc.cluster.local
```

| Pod | FQDN |
|-----|------|
| `postgres-0` | `postgres-0.postgres.roadwatch.svc.cluster.local` |
| `redis-0` | `redis-0.redis.roadwatch.svc.cluster.local` |
| `zookeeper-hlf-0` | `zookeeper-hlf-0.zookeeper-hlf.roadwatch.svc.cluster.local` |
| `zookeeper-events-0` | `zookeeper-events-0.zookeeper-events.roadwatch.svc.cluster.local` |
| `kafka-hlf-0` | `kafka-hlf-0.kafka-hlf-headless.roadwatch.svc.cluster.local` |
| `kafka-events-0` | `kafka-events-0.kafka-events-headless.roadwatch.svc.cluster.local` |
| `scheduler-0` | `scheduler-0.scheduler.roadwatch.svc.cluster.local` |

### ClusterIP aliases (short names for consumers)
| Name | Resolves to | Used by |
|------|-------------|---------|
| `postgres-rw` | postgres-0 | PgBouncer `DB_HOST` |
| `redis-rw` | redis-0 | anything that just needs `redis-rw:6379` |
| `kafka-hlf` | kafka-hlf-0 | fabric-anchor (consume) |
| `kafka-events` | kafka-events-0 | gateway, webhook-handler, fabric-anchor (produce) |

### Headless services (`clusterIP: None`)
Required so k8s creates per-pod DNS A records for StatefulSets. Used in:
- Kafka HLF `ADVERTISED_LISTENERS` → `kafka-hlf-0.kafka-hlf-headless`
- Kafka Events `ADVERTISED_LISTENERS` → `kafka-events-0.kafka-events-headless`
- Kafka `ZOOKEEPER_CONNECT` → `zookeeper-hlf-0.zookeeper-hlf` / `zookeeper-events-0.zookeeper-events`
- Redis `REDIS_URL` in pods → `redis-0.redis`
- Postgres direct connections → `postgres-0.postgres`

---

## Label Convention

Every resource carries three labels:

```yaml
app.kubernetes.io/name: <component>     # gateway | kafka | postgres | …
app.kubernetes.io/part-of: roadwatch    # always this value
layer: <layer>                          # platform | ingest-api | ingest-hlf | schedule | presentation
```

Pod templates additionally carry the selector label:

```yaml
app: <component>    # matched by Service selectors and kubectl -l app=…
```

`kubectl` selectors you'll use most:
```bash
kubectl get pods -n roadwatch -l app=kafka-hlf
kubectl get pods -n roadwatch -l app=kafka-events
kubectl get pods -n roadwatch -l layer=ingest-hlf
kubectl get pods -n roadwatch -l app.kubernetes.io/part-of=roadwatch
```

---

## Namespace

Everything lives in `roadwatch`. Created by `layer-0-platform/namespace.yaml`.

Kustomize `base/kustomization.yaml` sets `namespace: roadwatch` at the top level,
so every resource in the base inherits it. Overlay kustomizations repeat the
namespace field to make it explicit.

---

## Configuration Flow

```
secret.yaml          ──►  app-secrets  (POSTGRES_PASSWORD, JWT keys, API keys)
configmap-infra.yaml ──►  infra-config (Postgres/PgBouncer/Redis/Kafka endpoints)
configmap-app.yaml   ──►  app-config   (NODE_ENV, ports, cron schedules, flags)
configmap-fabric.yaml──►  fabric-config (MSP ID, channel, chaincode, cert paths)

fabric-certs Secret  ──►  mounted at /fabric/ in fabric-anchor pod only
postgres-init-sql CM ──►  mounted at /docker-entrypoint-initdb.d/ in postgres pod only
```

Each pod mounts its relevant ConfigMaps via `envFrom` + optional `env` overrides.
`DATABASE_URL` is assembled per-pod from `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`PGBOUNCER_HOST`, `PGBOUNCER_PORT` so every service talks through PgBouncer.

---

## Probe Strategy

| Component | Readiness | Liveness | Rationale |
|-----------|-----------|----------|-----------|
| postgres | `pg_isready` exec | `pg_isready` exec | Native tool, reliable |
| redis | `redis-cli ping` exec | `redis-cli ping` exec | Native tool, fast |
| pgbouncer | tcpSocket:6432 | — | Stateless; no liveness needed |
| zookeeper | tcpSocket:2181 | tcpSocket:2181 | `zkServer.sh` not on PATH in Confluent image; `ruok` blocked by ZK 3.6+ whitelist |
| kafka | tcpSocket:29092 | tcpSocket:29092 | `kafka-broker-api-versions` hangs under load → kills healthy broker |
| gateway-api | httpGet `/health` | httpGet `/health` | App-level health endpoint |
| backend-api | httpGet `/health` | httpGet `/health` | App-level health endpoint |
| frontend | httpGet `/` | httpGet `/` | nginx 200 = healthy |

---

## Known Bugs Fixed

### 1 — Kafka stale-IP controller loop
Deployment assigned a new pod IP on restart. Zookeeper retained the old IP in
`/brokers/ids/1`. The controller spun forever trying to reach a dead address.
**Fix**: StatefulSet — `kafka-0.kafka-headless` is a stable DNS name that survives
pod restarts. ADVERTISED_LISTENERS never changes.

### 2 — Zookeeper readiness probe failure
`zkServer.sh status` is not on PATH in the Confluent image. `ruok` is disabled
by default in ZK 3.6+ (blocked by the four-letter-words whitelist).
**Fix**: tcpSocket probe on port 2181. ZK is ready once it accepts TCP connections.

### 3 — Kafka liveness probe killing healthy broker
`kafka-broker-api-versions` hangs under load, causing the exec probe to time out
and Kubernetes to SIGKILL a healthy Kafka process.
**Fix**: tcpSocket probe on port 29092.

---

## Deployment Order

Dependencies flow top-to-bottom:

```
Layer 0 (postgres, redis) → must be ready before Layer 1
Layer 2 (kafka)           → must be ready before Layer 2 consumers
Layer 1 (gateway, backend)→ must be ready before frontend talks to them
Layer 3 (scheduler)       → only needs Postgres (Layer 0)
Layer 4 (frontend)        → stateless, no hard startup dependency
```

`deploy-kind.ps1` waits for each layer's pods before proceeding.
`k8s/deploy.ps1` does the same with `-Layer` flag for targeted updates.

---

## Future Enhancements

- [x] Istio Ambient (ztunnel + waypoint) + PeerAuthentication / AuthorizationPolicy / DestinationRules
- [x] PodDisruptionBudget for gateway / backend / webhook
- [x] HPA for gateway + backend; KEDA Kafka-lag scaling for webhook / fabric-anchor
- [x] Multi-replica Kafka (3 brokers per cluster, RF=3)
- [x] Postgres streaming replication (primary + replica)
- [x] Redis Sentinel (3 Redis + 3 Sentinel)
- [x] Prometheus + Loki + Grafana (`layer-observability`)
- [ ] Ingress with TLS termination (cert-manager + Let's Encrypt)
- [ ] NetworkPolicy for pod-to-pod isolation
- [ ] PodDisruptionBudget on all StatefulSets
- [ ] Velero PVC backups
- [ ] Jaeger distributed tracing
