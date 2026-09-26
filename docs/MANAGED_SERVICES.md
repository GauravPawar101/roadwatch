# Managed and free-tier infrastructure

How to run RoadWatch with as little of your own machine as possible: which
external services can replace each local component, the exact environment
variables to set, and the limits that will actually bite you.

Two rules make this work without code changes:

1. Every service resolves its endpoints through `@roadwatch/core`
   (`resolvePostgresEndpoint` / `resolveRedisEndpoint` / `resolveKafkaEndpoint`).
   Setting a `*_CLOUD_*` variable is all that is required — see
   [INFRA_CONFIG.md](./INFRA_CONFIG.md) for the precedence rules.
2. Managed database and cache endpoints require TLS. Put `?sslmode=require` on
   the Postgres URL and use `rediss://` for Redis, or the connection will be
   refused.

> **Vendor pricing and free-tier limits change constantly.** The figures below
> were read from vendor pricing pages on **26 September 2026**. Treat them as a
> starting point and re-check before depending on one. Everything else in this
> document is measured behaviour of this codebase.

---

## What each component is for

| Component | Local default | Used by | Notes |
|---|---|---|---|
| Postgres | `postgres:15-alpine` via pgbouncer | every service | primary datastore |
| Redis | `redis:7-alpine` | gateway, all services | idempotency, backpressure, rate limits, cache |
| Kafka (events) | `apache/kafka:3.8.0` | gateway, scheduler, webhook-handler, backend-api | operational events: SLA, notifications, triggers |
| Kafka (hlf) | `apache/kafka:3.8.0` | fabric-anchor-consumer | Fabric anchor backpressure only |

The two Kafka clusters are genuinely separate topics sets, not aliases. If you
only want one managed cluster, point both variables at the same brokers — the
resolver treats them independently.

---

## Postgres

### Neon (recommended free tier)

- **Free:** 100 CU-hours per project, 0.5 GB storage, 5 GB egress, 100 projects
- Scales to zero after 5 minutes idle, so a dev database costs nothing overnight
- Ships `pgvector`, `PostGIS` and `TimescaleDB` extensions, and pooled
  connections on every plan

```bash
export DATABASE_CLOUD_URL='postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require'
```

Two things to know:

- **0.5 GB is small.** The schema created by `docker/postgres/init.sql` is 53
  tables; a load test that inserts tens of thousands of complaint rows will fill
  it. Use a paid project, or a local Postgres, for load testing.
- **Scale-to-zero** adds a cold-start delay of a second or two on the first
  query after idling. Harmless for development, surprising in a latency test.

### Supabase

Free tier includes a Postgres database plus auth, storage and edge functions.
Useful if you want more than a database.

```bash
export DATABASE_CLOUD_URL='postgresql://postgres.PROJECT:PASSWORD@db.PROJECT.supabase.co:5432/postgres?sslmode=require'
```

### AWS RDS / Google Cloud SQL / Azure Database for PostgreSQL

No free tier worth planning around, but the `aws` overlay already targets this:

```bash
kubectl apply -k k8s/overlays/aws
```

### pgbouncer is bypassed when you use a managed database

The local stack points `DATABASE_URL` at pgbouncer (port 6432). A managed URL
points at the database itself, so **pgbouncer is not in the path at all** —
confirmed during testing, where pgbouncer sat at 0.7% CPU while the application
connected straight to the database.

Consequences:

- Connection count is bounded only by the application pool (`max: 20` per
  process). Most managed providers cap total connections well below
  `20 × replicas`; check the provider's limit before scaling out.
- Prefer a provider-supplied pooler. Neon includes one; on RDS put PgBouncer or
  the RDS Proxy in front and point `DATABASE_CLOUD_URL` at that instead.

---

## Redis

### Upstash

- **Free:** 256 MB, **500,000 commands per month**, 10,000 commands/second,
  1 database, TLS included
- Kafka-redis protocol compatible; `rediss://` works with the existing
  `REDIS_CLOUD_URL` variable

```bash
export REDIS_CLOUD_URL='rediss://default:TOKEN@apn1-xxx.upstash.io:6379'
```

**The free tier is command-limited, and this codebase is command-hungry.** A
complaint write costs roughly **8.7 Redis commands** (measured — see
[LOAD_TESTING.md](./LOAD_TESTING.md)), so 500,000 commands is about **57,000
complaint writes per month**. A busy development environment will exhaust that
quickly.

That number was 36.7 commands per write before the adaptive-limit cache was
added, which would have allowed only ~13,600 writes per month. If you are on a
command-metered plan, per-request Redis cost is worth watching:

```bash
podman exec roadwatch_managed_redis redis-cli INFO commandstats | grep cmdstat
```

Most of the remaining commands are the two admission permits each write takes
(one route-scoped, one global) in
`apps/gateway-api/src/security/write-backpressure.ts`. Collapsing those to a
single permit is the obvious next optimisation.

### Redis Cloud

Free tier available with a 30 MB database. Same variable:

```bash
export REDIS_CLOUD_URL='rediss://user:password@host:port'
```

### AWS ElastiCache / MemoryDB

For the `aws` overlay. Use `redis://` in-cluster or `rediss://` across TLS.

---

## Kafka

### Redpanda Cloud Serverless

Kafka-compatible, so it is a drop-in for both clusters — no client change.

- Serverless entry tier, 100 MB/s max write throughput, 99.9% SLA
- Multi-tenant on AWS and GCP
- Built-in schema registry and HTTP proxy

```bash
export KAFKA_EVENTS_CLOUD_BROKERS='b-1.pxcd.redpanda.com:9092,b-2.pxcd.redpanda.com:9092'
export KAFKA_HLF_CLOUD_BROKERS='b-1.pxcd.redpanda.com:9092,b-2.pxcd.redpanda.com:9092'
```

Needs TLS and SASL in production; the broker list is the same variable either
way, and credentials travel through the standard Kafka client config.

### Confluent Cloud

Free tier gives a trial cluster with a limited number of Kafka units. Same
variables; brokers are in the `pkc-*.gcp.confluent.cloud` form.

### AWS MSK

For the `aws` overlay. Note MSK bills per broker-hour, so a two-broker cluster
is a real recurring cost — for development, Redpanda Serverless is cheaper.

### Cost note

Kafka was the most memory-hungry component in local testing: **481 MB per
cluster, ~962 MB for both**, more than the Postgres instances combined. If you
only need one cluster in development, run one.

---

## Everything else the system needs

Beyond the data stores, these are the other things a deployment reaches for.
None are configured by the endpoint resolver, so each needs its own wiring.

| Need | Free option | What you must do |
|---|---|---|
| Object storage (media, proof photos) | Cloudflare R2 (10 GB free), or MinIO self-hosted | `media-ingest` writes here; set its bucket credentials |
| Maps / geocoding | OpenStreetMap + Nominatim, or MapLibre with self-hosted tiles | frontend tile URL; Nominatim needs a real `User-Agent` and has a strict usage policy |
| Push / SMS / email notifications | provider-specific | the notification dispatcher needs credentials; it degrades to logging without them |
| Metrics | Prometheus + Grafana, already in `docker-compose.yml` | none |
| Secrets in Kubernetes | Sealed Secrets, or SOPS | see `k8s/overlays/managed/managed-endpoints.example.yaml` |
| Vector search for complaint text | pgvector, already an extension on Neon | nothing extra if you use Neon |
| Blockchain anchoring | Hyperledger Fabric | the `hlf` Kafka cluster and Fabric gateway config; this is the one component with no credible hosted free tier |

Fabric is worth calling out: the anchoring consumer needs a Fabric Gateway and
a certificate authority. There is no free managed offering. For development,
run it locally; for anything else, budget for it or disable the consumer.

---

## Verifying a managed endpoint is actually used

Setting the variable is easy to get wrong — a typo silently falls back to the
in-cluster endpoint. Two ways to check.

**1. Unit and integration tests.** `packages/core/src/postgres-endpoint.test.ts`
and friends assert precedence directly:

```bash
npx turbo run test --filter=@roadwatch/core --filter=@roadwatch/redis --filter=@roadwatch/kafka
```

**2. A live probe against a second real server.** The `cloud-sim` compose
profile starts a second Postgres and Redis so precedence can be observed rather
than assumed:

```bash
./ops/dev/compose.sh up -d postgres pgbouncer redis kafka-hlf kafka-events
./ops/dev/compose.sh --profile cloud-sim up -d managed-postgres managed-redis

# Point the "cloud" tier at the stand-ins.
export DATABASE_CLOUD_URL='postgresql://postgres:postgres@127.0.0.1:15434/roadwatch'
export REDIS_CLOUD_URL='redis://127.0.0.1:16380/0'

pnpm tsx tools/verify/cloud-precedence.mts
```

Expected:

```
PASS  pool dials the managed database
PASS  managed database actually received the write
PASS  in-cluster database did NOT receive the write
...
12/12 checks passed
```

The probe writes a row and a key, then asks *both* servers which one received
it. If precedence were broken the data would appear on the in-cluster instance
and the run would fail. It also checks the reverse direction, so a resolver that
always preferred "cloud" would fail too.

**In-cluster check.** Every service logs its resolved tier at startup with
credentials redacted:

```bash
grep Endpoints <service>.log
# [scheduler] Endpoints: postgres[cloud] redis[cloud] kafka.events[cloud] kafka.hlf[in-cluster]
```

If you expected `cloud` and see `in-cluster`, the variable is empty, misspelled,
or shadowed. See [INFRA_CONFIG.md](./INFRA_CONFIG.md#why-cloud-is-checked-first).
