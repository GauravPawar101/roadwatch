# RoadWatch Kubernetes Manifests

> Full deployment guide: [docs/operations/deployment.md](../docs/operations/deployment.md) · Architecture: [docs/architecture/kubernetes.md](../docs/architecture/kubernetes.md)

## Directory Layout

```
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── layer-0-platform/          # Postgres, PgBouncer, Redis + their ConfigMaps/Secrets
│   │   ├── namespace.yaml
│   │   ├── configmap-infra.yaml
│   │   ├── configmap-app.yaml
│   │   ├── configmap-cluster.yaml   # FABRIC_HOST_IP → fabric-anchor hostAliases
│   │   ├── configmap-postgres-init.yaml
│   │   ├── secret.yaml
│   │   ├── postgres.yaml
│   │   ├── pgbouncer.yaml
│   │   └── redis.yaml
│   ├── layer-1-ingest-api/        # gateway-api, backend-api (Deployments + HPAs)
│   │   ├── gateway-api.yaml
│   │   └── backend-api.yaml
│   ├── layer-mesh/                # Istio SAs, mTLS, AuthorizationPolicy, DestinationRules, PDBs
│   ├── layer-2-ingest-hlf/        # Kafka (HLF + events), consumers + webhook HPA
│   │   ├── configmap-fabric.yaml
│   │   ├── kafka-hlf.yaml
│   │   ├── kafka-events.yaml
│   │   └── consumers.yaml
│   ├── layer-3-schedule/          # scheduler (StatefulSet, replicas=1)
│   │   └── scheduler.yaml
│   └── layer-4-presentation/
│       ├── configmap-frontend.yaml
│       └── frontend.yaml
├── overlays/
│   ├── dev/                       # dev log level, FABRIC_HOST_IP for kind
│   ├── prod/                      # prod limits, HPA, FABRIC_HOST_IP
│   └── aws/                       # managed RDS/MSK/Redis endpoints
├── kind-config.yaml
├── deploy.ps1                     # Apply overlay to existing cluster
├── ARCHITECTURE.md
└── README.md
```

---

## Configuration Reference

### ConfigMaps (non-sensitive, committed to git)

| ConfigMap | Key file | What it holds |
|-----------|----------|---------------|
| `infra-config` | `layer-0-platform/configmap-infra.yaml` | Postgres/PgBouncer host+port+db+user, Redis URL, Kafka brokers, internal service URLs |
| `app-config` | `layer-0-platform/configmap-app.yaml` | Ports, cron schedules, CORS, feature flags (no district/geo scope) |
| `cluster-config` | `layer-0-platform/configmap-cluster.yaml` | `FABRIC_HOST_IP` (wired into fabric-anchor via kustomize replacements) |
| `frontend-config` | `layer-4-presentation/configmap-frontend.yaml` | `VITE_API_BASE` for frontend image build |
| `fabric-config` | `layer-2-ingest-hlf/configmap-fabric.yaml` | MSP ID, channel, chaincode name, peer endpoint, cert mount paths, Kafka consumer group |
| `postgres-init-sql` | generated from `docker/postgres/init.sql` | DB schema SQL — injected into `/docker-entrypoint-initdb.d` |

### Secrets (sensitive — never commit real values)

| Secret | How created | Keys |
|--------|-------------|------|
| `app-secrets` | `layer-0-platform/secret.yaml` (dev placeholders) or `kubectl create secret` (prod) | `POSTGRES_PASSWORD`, `JWT_SECRET`, `ACCESS_SECRET`, `REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` + optional keys below |
| `fabric-certs` | `ops/deploy/deploy-kind.ps1` at deploy time (or manual `kubectl create secret`) | `tls-ca.crt`, `msp-cert.pem`, `msp-key.pem` |

Optional keys in `app-secrets` (leave empty until the service is wired up):
- `GEMINI_API_KEY`
- `PHONE_HASH_PEPPER`, `PHONE_ENC_KEY`
- `FCM_SERVER_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`

---

## What You Must Set Before Deploying

### Local (kind) — minimum viable

Everything in `secret.yaml` already has dev-safe placeholder values. The only thing
you **must** supply before a full deploy is the Fabric cert paths if you want
`fabric-anchor` to connect. Without them, use `-SkipFabricCerts` and the pod will
crash-loop harmlessly until you create the Secret later.

| Where | Key/Flag | Value |
|-------|----------|-------|
| env or shell | `$env:FABRIC_TLS_CERT_PATH` | `fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\peers\peer0.nhai.roadwatch.com\tls\ca.crt` |
| env or shell | `$env:FABRIC_X509_CERT_PATH` | `fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\users\Admin@nhai.roadwatch.com\msp\signcerts\cert.pem` |
| env or shell | `$env:FABRIC_X509_KEY_PATH` | `fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\users\Admin@nhai.roadwatch.com\msp\keystore\priv_sk` |

These paths are the defaults — if you used `fabric/network/scripts/start.sh` without
customisation you don't need to set them at all; the script will find them automatically.

### Production — what to override in `app-secrets`

Create/update the Secret before applying the prod overlay:

```powershell
kubectl create secret generic app-secrets `
  --from-literal=POSTGRES_PASSWORD='<strong-password>' `
  --from-literal=JWT_SECRET='<32+-char-random>' `
  --from-literal=ACCESS_SECRET='<32+-char-random>' `
  --from-literal=REFRESH_SECRET='<32+-char-random>' `
  --from-literal=INTERNAL_SERVICE_TOKEN='<32+-char-random>' `
  --from-literal=SUPABASE_URL='https://<project>.supabase.co' `
  --from-literal=SUPABASE_ANON_KEY='<supabase-anon-key>' `
  --namespace roadwatch `
  --dry-run=client -o yaml | kubectl apply -f -
```

And the Fabric certs:

```powershell
kubectl create secret generic fabric-certs `
  --from-file=tls-ca.crt=/path/to/peer/tls/ca.crt `
  --from-file=msp-cert.pem=/path/to/user/cert.pem `
  --from-file=msp-key.pem=/path/to/user/key.pem `
  --namespace roadwatch `
  --dry-run=client -o yaml | kubectl apply -f -
```

---

## Deploying

### Local — kind (build + load + apply)

```powershell
# Full deploy (build images, load into kind, apply all layers)
.\ops\deploy\deploy-kind.ps1 -SkipFabricCerts

# Fabric network already running — include certs
.\ops\deploy\deploy-kind.ps1

# Tear down and start fresh
.\ops\deploy\deploy-kind.ps1 -Reset -SkipFabricCerts

# Skip docker build (images already in local daemon)
.\ops\deploy\deploy-kind.ps1 -SkipBuild -SkipFabricCerts

# Infra only — layer-0 (Postgres/Redis) + layer-2 (Kafka), no app images
.\ops\deploy\deploy-kind.ps1 -InfraOnly -SkipFabricCerts
```

### Local — apply only (images already loaded)

```powershell
# All layers
.\k8s\deploy.ps1

# Single layer
.\k8s\deploy.ps1 -Layer 0    # Postgres, Redis, PgBouncer
.\k8s\deploy.ps1 -Layer 2    # Kafka + consumers
.\k8s\deploy.ps1 -Layer 1    # gateway-api, backend-api
```

### Production — kustomize overlay

```bash
kubectl apply -k k8s/overlays/prod

# Preview generated manifests without applying
kubectl kustomize k8s/overlays/prod
```

---

## Services and Ports

| Service | k8s name | Type | Port | NodePort (kind) |
|---------|----------|------|------|-----------------|
| Frontend | `frontend` | NodePort | 80 | **30080** |
| Gateway API | `gateway` | NodePort | 3100 | **30100** |
| Backend API | `backend` | NodePort | 4001 | **30401** |
| Postgres (headless) | `postgres` | ClusterIP/None | 5432 | — |
| Postgres (alias) | `postgres-rw` | ClusterIP | 5432 | — |
| PgBouncer | `pgbouncer` | ClusterIP | 6432 | — |
| Redis (headless) | `redis` | ClusterIP/None | 6379 | — |
| Redis (alias) | `redis-rw` | ClusterIP | 6379 | — |
| Kafka HLF (headless) | `kafka-hlf-headless` | ClusterIP/None | 29092 | — |
| Kafka HLF (clients) | `kafka-hlf` | ClusterIP | 29092 | — |
| Kafka Events (headless) | `kafka-events-headless` | ClusterIP/None | 29092 | — |
| Kafka Events (clients) | `kafka-events` | ClusterIP | 29092 | — |
| Zookeeper HLF (headless) | `zookeeper-hlf` | ClusterIP/None | 2181 | — |
| Zookeeper Events (headless) | `zookeeper-events` | ClusterIP/None | 2181 | — |

---

## Label Convention

Every resource carries:
```yaml
app.kubernetes.io/name: <component>     # e.g. gateway, kafka, postgres
app.kubernetes.io/part-of: roadwatch
layer: <layer-name>                     # platform | ingest-api | ingest-hlf | schedule | presentation
```

Pod selector labels (used by Services and StatefulSet selectors):
```yaml
app: <component>    # e.g. app: kafka, app: redis
```

---

## Useful Commands

```bash
# All pods
kubectl get pods -n roadwatch

# Logs
kubectl logs -n roadwatch deploy/gateway -f
kubectl logs -n roadwatch deploy/backend -f
kubectl logs -n roadwatch deploy/fabric-anchor -f
kubectl logs -n roadwatch statefulset/scheduler -f

# Describe a stuck pod
kubectl describe pod -n roadwatch <pod-name>

# Decode a secret value
kubectl get secret app-secrets -n roadwatch \
  -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d

# Port-forward (bypass NodePort)
kubectl port-forward -n roadwatch svc/gateway 3100:3100
kubectl port-forward -n roadwatch svc/postgres 5432:5432

# Restart a deployment
kubectl rollout restart -n roadwatch deployment/gateway

# Exec into a pod
kubectl exec -it -n roadwatch deploy/gateway -- sh

# Events (sorted)
kubectl get events -n roadwatch --sort-by='.lastTimestamp'

# Tear down
kubectl delete namespace roadwatch
kind delete cluster --name roadwatch
```

---

## Troubleshooting

### ErrImageNeverPull on gateway / backend
Images must be built locally and loaded into kind. Run:
```powershell
.\ops\deploy\deploy-kind.ps1 -SkipFabricCerts
```
Or if the cluster already exists and you just need to load:
```powershell
docker build -t roadwatch/gateway-api:local -f apps/gateway-api/Dockerfile .
kind load docker-image roadwatch/gateway-api:local --name roadwatch
kubectl rollout restart -n roadwatch deployment/gateway
```

### Kafka controller→stale-IP loop
**Fixed** — both Zookeeper and Kafka run as StatefulSets. `kafka-0.kafka-headless`
never changes address across restarts, so ZK's `/brokers/ids/1` entry stays valid.

### Zookeeper readiness probe failing
**Fixed** — tcpSocket probe on port 2181. The `zkServer.sh` command is not on PATH
in the Confluent image and `ruok` is blocked by the ZK 3.6+ four-letter whitelist.

### Kafka liveness probe killing healthy broker
**Fixed** — tcpSocket probe on port 29092. `kafka-broker-api-versions` hangs under
load and caused the old exec probe to time out and kill a healthy process.

### PVC permission errors (Confluent images)
`initContainer` runs `chown -R 1000:1000` as root before the main container starts.
The `local-path` provisioner creates PVC directories as `root:root`; Confluent
images run as `appuser` (uid=1000).

### fabric-anchor crash-loops
Either the `fabric-certs` Secret is missing or `FABRIC_HOST_IP` is wrong.
```bash
kubectl get secret fabric-certs -n roadwatch          # check Secret exists
kubectl describe pod -n roadwatch -l app=fabric-anchor # check hostAliases IP
kubectl exec -it -n roadwatch deploy/fabric-anchor -- \
  nc -zv peer0.nhai.roadwatch.com 17051               # test reachability
```

### Database connection issues
```bash
kubectl run -it --rm debug --image=postgres:16-alpine --restart=Never -n roadwatch -- \
  psql postgresql://postgres:postgres@pgbouncer:6432/roadwatch -c "SELECT version();"
```
