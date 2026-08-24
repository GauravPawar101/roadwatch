# Architecture Overview

RoadWatch is a pnpm monorepo that connects citizen-facing apps, a REST API layer, event streaming, and Hyperledger Fabric for immutable audit trails.

## System diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │   Frontend   │  │ Mobile Host  │  │  Public dashboards (/public) │ │
│  │  React/Vite  │  │ React Native │  │  Analytics, chronic roads    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘ │
└─────────┼─────────────────┼─────────────────────────┼───────────────────┘
          │                 │                         │
          └─────────────────┼─────────────────────────┘
                            │ HTTPS / REST
┌───────────────────────────▼─────────────────────────────────────────────┐
│                         API LAYER                                        │
│  ┌─────────────────────────────┐  ┌──────────────────────────────────┐  │
│  │       Gateway API           │  │         Backend API              │  │
│  │  Auth, routes, outbox, SSE  │  │  Internal complaints, analytics │  │
│  │  Port 3100                  │  │  Port 4001                      │  │
│  └──────────────┬──────────────┘  └──────────────┬───────────────────┘  │
└─────────────────┼────────────────────────────────┼──────────────────────┘
                  │                                │
┌─────────────────▼────────────────────────────────▼──────────────────────┐
│                         DATA & EVENTS                                    │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Postgres │  │  PgBouncer  │  │    Redis     │  │  Kafka (dual)   │  │
│  │  :15433  │  │   :16432    │  │   :16379     │  │ HLF :9094       │  │
│  │          │  │             │  │              │  │ Events :9095      │  │
│  └──────────┘  └─────────────┘  └──────────────┘  └────────┬────────┘  │
└──────────────────────────────────────────────────────────────┼───────────┘
                                                               │
┌──────────────────────────────────────────────────────────────▼───────────┐
│                         WORKERS                                         │
│  ┌────────────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ Fabric Anchor      │  │ Webhook Handler │  │ Scheduler            │  │
│  │ Consumer           │  │ (kafka-events)  │  │ (cron: SLA, karma)   │  │
│  │ (kafka-hlf→Fabric) │  │                 │  │                      │  │
│  └─────────┬──────────┘  └─────────────────┘  └──────────────────────┘  │
└────────────┼────────────────────────────────────────────────────────────┘
             │ gRPC
┌────────────▼────────────────────────────────────────────────────────────┐
│                    HYPERLEDGER FABRIC (external)                         │
│  Channel: roadwatch-india  |  Chaincode: complaint-anchor               │
│  Orgs: NHAIMSP, RoadWatchMSP  |  Orderer: Raft (3 nodes, 1 active dev)  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Monorepo layout

| Path | Contents |
|------|----------|
| `apps/gateway-api` | Primary REST API |
| `apps/mobile-host` | React Native shell |
| `backend-api` | Internal data API |
| `frontend` | Web dashboard (all roles) |
| `services/` | Background workers (scheduler, webhook-handler, fabric-anchor-consumer, media-ingest) |
| `packages/` | Shared libraries (core, kafka, redis, adapters, features, config) |
| `fabric/` | Fabric network config, chaincodes, deploy scripts |
| `docker/` | Postgres init SQL, Docker env templates |
| `k8s/` | Kubernetes manifests (layer-based Kustomize) |
| `ops/` | Dev bootstrap, deploy scripts, teardown |
| `scripts/` | CLI utilities (Fabric ledger, seed, messaging init) |
| `config/` | Messaging topology, districts, Fabric config copies |

## Design principles

1. **Postgres is the source of truth** — Fabric stores Merkle anchors and audit metadata, not full complaint payloads.
2. **Dual Kafka clusters** — HLF cluster buffers backpressure; Events cluster drives notifications, SLA, and webhooks.
3. **Transactional outbox** — Gateway writes events to `kafka_event_outbox` in the same DB transaction as complaint inserts, then a relay publishes to Kafka.
4. **Istio mesh** — In-cluster service identity via Envoy mTLS; local uses `INTERNAL_SERVICE_TOKEN` for `/internal/*`.
5. **Country adapters** — India-specific legal frameworks (RTI deadlines, NHAI/PWD hierarchies) live in `packages/adapters`.

## User roles

| Role | Code | Access |
|------|------|--------|
| Citizen | `CITIZEN` | File complaints, track status, karma |
| Authority (EE) | `EE` | Triage, assign, resolve complaints in jurisdiction |
| Chief Engineer | `CE` | Super-admin, ministry reports, cross-district analytics |
| Contractor | `CONTRACTOR` | Repair proofs, assigned work orders |
| Public | — | Read-only dashboards at `/public` (no login) |

## Key technologies

| Layer | Stack |
|-------|-------|
| API | Node.js, Express, TypeScript |
| Frontend | React 18, Vite, Tailwind |
| Mobile | React Native 0.73 |
| Database | PostgreSQL 15, PgBouncer |
| Cache | Redis 7 |
| Messaging | Apache Kafka (Confluent 7.7) × 2 clusters |
| Blockchain | Hyperledger Fabric 2.x, Go chaincode |
| Orchestration | Docker Compose (dev), Kind/k8s (integration), Turbo (monorepo) |
| AI | Gemini / Ollama / llama.cpp via LangGraph pipeline |

## Related docs

- [Event pipeline](./event-pipeline.md)
- [Fabric network](./fabric-network.md)
- [Data model](./data-model.md)
- [Security and auth](./security-and-auth.md)
- [Kubernetes layers](./kubernetes.md)
