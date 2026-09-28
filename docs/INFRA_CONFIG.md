# Infrastructure endpoint configuration

Every service resolves Postgres, Redis and Kafka through one shared contract in
[`packages/core/src/config/endpoints.ts`](../packages/core/src/config/endpoints.ts),
so no service can silently point at the wrong place.

## Precedence

For every endpoint:

```
managed/cloud  ->  explicit URL  ->  in-cluster parts  ->  built-in local default
```

| Tier | Postgres | Redis | Kafka (per cluster) |
|---|---|---|---|
| cloud | `DATABASE_CLOUD_URL`, `POSTGRES_CLOUD_URL` | `REDIS_CLOUD_URL`, `REDIS_MANAGED_URL` | `KAFKA_<CLUSTER>_CLOUD_BROKERS`, `KAFKA_<CLUSTER>_MANAGED_BROKERS` |
| explicit | `DATABASE_URL` | `REDIS_URL`, `REDIS_URI` | `KAFKA_<CLUSTER>_BROKERS`, `KAFKA_<CLUSTER>_BROKER` |
| parts | `POSTGRES_HOST/PORT/DB/USER/PASSWORD` (also `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`) | `REDIS_HOST/PORT/DB/PASSWORD`, `REDIS_TLS` | `KAFKA_BROKERS`/`KAFKA_BROKER` (events cluster only) |
| default | `127.0.0.1:16432/roadwatch` | — | `127.0.0.1:9095` |

`<CLUSTER>` is `EVENTS` or `HLF`.

Empty and whitespace-only values are treated as unset, so a ConfigMap can ship
every key with `""` and the fallbacks still apply.

### Why cloud is checked first

In Kubernetes the deployments always materialise `DATABASE_URL`, `REDIS_URL` and
`KAFKA_*_BROKERS` from the generic `infra-config` ConfigMap. If "explicit" were
consulted first it would always be satisfied and a managed endpoint could never
take effect. A `*_CLOUD_*` variable is a deliberate deployment-target choice, so
it outranks the generic name.

## Verifying what resolved

Each service logs its resolved tiers at startup:

```
[scheduler] Endpoints: postgres[in-cluster] redis[cloud] kafka.events[cloud] kafka.hlf[in-cluster] redis.url=//***@... kafka.events.brokers=...
```

Credentials are redacted. If you expected `cloud` and see `in-cluster`, the
`*_CLOUD_*` variable is empty or misspelled.

## Using managed services

Two options, neither of which requires a code change.

**Any provider** — create the optional Secret, then apply the `managed` overlay:

```bash
kubectl -n roadwatch create secret generic managed-endpoints \
  --from-literal=DATABASE_CLOUD_URL='postgresql://user:pass@host:5432/roadwatch?sslmode=require' \
  --from-literal=REDIS_CLOUD_URL='rediss://host:6379/0' \
  --from-literal=KAFKA_EVENTS_CLOUD_BROKERS='b-1:9094,b-2:9094' \
  --from-literal=KAFKA_HLF_CLOUD_BROKERS='b-1:9094,b-2:9094'

kubectl apply -k k8s/overlays/managed
```

Every deployment references the Secret with `optional: true`, so a cluster
without it starts normally on the in-cluster endpoints. See
[`k8s/overlays/managed/managed-endpoints.example.yaml`](../k8s/overlays/managed/managed-endpoints.example.yaml)
for all supported keys.

**AWS** — fill in the placeholders in
[`k8s/overlays/aws/configmap-infra-patch.yaml`](../k8s/overlays/aws/configmap-infra-patch.yaml)
and apply `k8s/overlays/aws`.

Managed databases and caches require TLS: include `?sslmode=require` on the
Postgres URL and use `rediss://` for Redis.

For provider choices, free-tier limits and the per-request Redis cost that
determines how much of a command-metered plan you get, see
[MANAGED_SERVICES.md](./MANAGED_SERVICES.md).

## Verifying precedence against a real second server

Setting the variable is easy to get subtly wrong, and a typo silently falls
back to the in-cluster endpoint. The `cloud-sim` compose profile starts a second
Postgres and Redis that stand in for a managed offering, so precedence can be
observed rather than assumed:

```bash
./ops/dev/compose.sh up -d postgres pgbouncer redis kafka-hlf kafka-events
./ops/dev/compose.sh --profile cloud-sim up -d managed-postgres managed-redis

export DATABASE_CLOUD_URL='postgresql://postgres:postgres@127.0.0.1:15434/roadwatch'
export REDIS_CLOUD_URL='redis://127.0.0.1:16380/0'

pnpm tsx tools/verify/cloud-precedence.mts
```

The probe writes a row and a key, then asks both servers which one received
it. Expected output is `12/12 checks passed`. It also verifies the reverse
direction, so a resolver that always preferred "cloud" would fail as well.

## Local development

`ops/deploy/deploy-kind.sh` runs the whole stack in a kind cluster on **podman**
by default:

```bash
pnpm k8s:up          # create cluster, build + load images, install Istio/KEDA, apply overlay
pnpm k8s:status
pnpm k8s:logs
pnpm k8s:down        # delete the cluster
```

The container runtime is selected with `CONTAINER_RUNTIME` (`podman` default,
`docker` supported):

```bash
CONTAINER_RUNTIME=docker pnpm k8s:up
```

Outside Kubernetes the fallbacks land on the local defaults
(`127.0.0.1:16432` for the pgbouncer-fronted Postgres and `127.0.0.1:9095` for
the events Kafka cluster), which is what `docker-compose.yml` provides:

```bash
./ops/dev/compose.sh up -d postgres pgbouncer redis kafka-hlf kafka-events
```

Note that a managed `DATABASE_CLOUD_URL` points at the database directly, so
**pgbouncer is not in the connection path** and connection count is bounded only
by each process's own pool (`max: 20`). Check your provider's connection limit
before scaling out replicas. See
[MANAGED_SERVICES.md](./MANAGED_SERVICES.md#pgbouncer-is-bypassed-when-you-use-a-managed-database).

### kind on rootless podman

kind's podman provider is experimental and, when running rootless, requires the
user systemd unit for `podman.service` to expose the `Delegate` property over
D-Bus. `deploy-kind.sh` checks this before creating the cluster and prints the
remediation if it is missing. Two ways forward:

```bash
# user-level drop-in (works on most hosts)
mkdir -p ~/.config/systemd/user/podman.service.d
printf '[Service]\nDelegate=yes\n' > ~/.config/systemd/user/podman.service.d/override.conf
systemctl --user daemon-reload && systemctl --user restart podman.service
busctl --user get-property org.freedesktop.systemd1 \
  /org/freedesktop/systemd1/unit/podman_2eservice \
  org.freedesktop.systemd1.Unit Delegate     # must print: s "yes"
```

If that property is unavailable (some systemd builds do not expose cgroup
properties on the user-bus `Unit` interface), run podman as root — the check is
skipped there — or set `CONTAINER_RUNTIME=docker`.
