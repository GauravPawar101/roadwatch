# RoadWatch Current State

**Snapshot date:** June 5, 2026

This document is the current source of truth for what is in the repository, what each service does, which versions are pinned, and how the main flows connect end to end.

---

## Repo Structure — 4-Layer Architecture

The repository enforces a strict 4-layer layout. Dependency direction is **services → k8s → ops**; layers never reverse.

```
Layer 1 — Applications (source code only, no YAML, no scripts)
  apps/gateway-api/        Primary API backend
  apps/mobile-host/        React Native mobile host
  backend-api/             Auxiliary complaint/media backend
  frontend/                React + Vite web dashboard
  services/                Four standalone microservices
  packages/                All shared workspace packages
  chaincode/               TypeScript Fabric chaincode stub

Layer 2 — Infrastructure (Kubernetes manifests only, nothing executable)
  k8s/base/                Base Kustomize manifests
  k8s/overlays/dev/        Dev overlay
  k8s/overlays/prod/       Prod overlay

Layer 3 — Operations (scripts only, no business logic, no YAML duplication)
  ops/dev/                 setup.ps1, start-all.ps1, start-all.sh, start.ps1, stop-all.sh
  ops/deploy/              fabric-env.sh, fabric-start.sh, fabric-deploy-chaincode.sh, deploy-kind.ps1
  ops/teardown/            stop-all.ps1
  ops/tools/               One-shot data migration utilities

Layer 4 — Runtime (never committed, always recreated)
  runtime/                 fabric-artifacts/, generated/, logs/
```

**Gitignored runtime artifacts:** `bin/`, `.pids/`, `logs/`, `config_block.*`, `core.yaml`

---

## Repo Baseline

- Package manager: `pnpm@8.10.0`
- Monorepo orchestration: `turbo`
- Primary shared language: TypeScript `^5.8.3`
- Main backend stack: Express `4.21.2`, PostgreSQL (via PgBouncer), Kafka, Hyperledger Fabric
- Main web stack: React `18.2.0` with Vite `5.4.21`
- Main mobile stack: React Native `0.73.0`

---

## What Is In The Repo Now

### Active app surfaces

- `apps/gateway-api` — primary authenticated API, realtime SSE, auth, public dashboards, RTI, reports, notifications, AI agent endpoint.
- `frontend` — browser dashboard and public/citizen web app.
- `apps/mobile-host` — React Native mobile host with offline-first complaint, map, and agent screens.
- `backend-api` — auxiliary complaint/image/analytics backend sharing the gateway database.

### Background and integration services

- `services/fabric-anchor-consumer` — consumes `complaint-submitted`, batches Merkle roots, and anchors them to Fabric.
- `services/webhook-handler` — consumes Kafka topics and applies state changes, notification writes, and audit logging.
- `services/scheduler` — cron-based maintenance and housekeeping service.
- `services/media-ingest` — media submission backend. Activated via `docker compose --profile media up`. Not in the default compose stack.

### Shared packages (`packages/`)

All entries are registered workspace members in `pnpm-workspace.yaml`.

| Package | Path | Purpose |
|---|---|---|
| `@roadwatch/core` | `packages/core/` | Domain models, engines, escalation subsystem, AI prompt templates |
| `@roadwatch/config` | `packages/config/` | Shared configuration |
| `@roadwatch/kafka` | `packages/kafka/` | KafkaJS client, producer, topic definitions |
| `@roadwatch/redis` | `packages/redis/` | ioredis client, idempotency, backpressure utilities |
| `@roadwatch/authority-node` | `packages/authority-node/` | Fabric custodial signer, org cert manager, OTP audit layer |
| `@roadwatch/providers` | `packages/providers/` | Storage, event streaming, map, AI, media, Fabric gateway adapters |
| `@roadwatch/adapters` | `packages/adapters/` | Country-specific business logic |
| `@roadwatch/features/*` | `packages/features/` | Reusable UI feature modules |
| `@roadwatch/providers/storage-sqlite` | `packages/providers/storage-sqlite/` | Mobile local SQLite storage |
| `@roadwatch/test-utils` | `packages/test-utils/` | Shared testing utilities |

### Blockchain

- `chaincode/` — TypeScript Hyperledger Fabric chaincode stub (workspace member).
- `fabric/chaincode/*/` — Go chaincodes (complaint-anchor and others).
- `fabric/network/` — Full Fabric network: docker-compose, scripts, org config.

### Operations and tooling

- `ops/dev/` — `setup.ps1`, `start-all.ps1`, `start-all.sh`, `start.ps1`, `stop-all.sh`
- `ops/deploy/` — `fabric-env.sh`, `fabric-start.sh`, `fabric-deploy-chaincode.sh`, `deploy-kind.ps1`
- `ops/teardown/` — `stop-all.ps1`
- `ops/tools/` — `backfill-embeddings-to-vector.js`, `migrate-postgres-to-cassandra.js`
- `tools/` — dev tooling: chaos runner, k6 load runner, prompt regression tests, import codemod, `produce-test-events.ts`
- `scripts/` — remaining dev utilities: `fabric-ledger.ts`, `seed-backend.ts`, `test-ids.ts`, `init-messaging.ps1`, `setup-sidecar-auth.sh`, `migrate/`

---

## Version Matrix

| Surface | Key versions | Role | State |
|---|---|---|---|
| Root workspace | `pnpm@8.10.0`, turbo | Monorepo | Active |
| `apps/gateway-api` | Express `4.21.2`, LangGraph `0.4.3`, Zod `3.25.76`, Pg `8.13.1` | Main API | Active |
| `frontend` | React `18.2.0`, Vite `5.4.21`, TanStack Query `5.100.10` | Browser web app | Active |
| `apps/mobile-host` | React Native `0.73.0`, React Navigation `6.1.18` | Mobile shell | Active |
| `backend-api` | Express `4.21.2`, Pg `8.13.1` | Auxiliary API | Active / auxiliary |
| `services/fabric-anchor-consumer` | Fabric Gateway `1.9.1`, KafkaJS `2.2.4` | Blockchain anchor | Active |
| `services/webhook-handler` | KafkaJS `2.2.4`, Pg `8.13.1` | Kafka consumer | Active |
| `services/scheduler` | `node-cron` `3.0.3`, Pg `8.13.1` | Cron maintenance | Active |
| `services/media-ingest` | `0.1.0` | Media prototype | `--profile media` only |
| `packages/kafka` | KafkaJS `2.2.4` | Kafka adapter | Active |
| `packages/redis` | ioredis `5.10.1` | Redis adapter | Active |
| `packages/authority-node` | Fabric Gateway SDK, express | Custodial signing | Active |
| `packages/core` | `0.0.0` | Domain + escalation + prompts | Active |

---

## Canonical Runtime Topology

### Main request path

1. Client hits the web or mobile app.
2. The app calls `apps/gateway-api` for auth, public dashboards, complaint submission, RTI, reports, and notifications.
3. `apps/gateway-api` writes to PostgreSQL and publishes Kafka events.
4. `services/fabric-anchor-consumer` consumes complaint submission events and anchors Merkle roots to Fabric.
5. `services/webhook-handler` consumes Kafka topics and writes downstream state, logs, and notifications.
6. `frontend` and `apps/mobile-host` read back the updated complaint state through API routes and SSE.

### Auxiliary request path

1. Some media and verification flows go through `backend-api`.
2. `backend-api` validates JWT, applies geofence and timestamp checks, and uses the shared gateway database.
3. It writes complaint rows, attachment rows, audit rows, and emits complaint events.

---

## End-To-End Flows

### 1. Citizen complaint submission

1. A citizen uses `frontend` or `apps/mobile-host` to submit a complaint.
2. The client authenticates through the gateway auth flow and obtains a JWT.
3. `apps/gateway-api` validates the request, checks road geometry and distance, stores the complaint, and publishes `complaint-submitted`.
4. `services/fabric-anchor-consumer` batches submissions, builds a Merkle tree, submits `SubmitMerkleRoot` to Fabric, stores the proof, and emits `complaint-anchored`.
5. `services/webhook-handler` receives the Kafka event and updates complaint state, notification records, and audit logs.
6. The web and mobile clients show the updated complaint state through API reads and SSE.

### 2. Authority complaint handling

1. An authority user logs in through `apps/gateway-api`.
2. The authority dashboard in `frontend` reads the complaint queue and analytics.
3. Status changes, assignments, repair verification, and escalation actions hit `/authority` routes in the gateway.
4. The gateway persists the state change, publishes Kafka events, writes audit rows, and fans out notifications.
5. The realtime SSE stream notifies connected clients.

### 3. High-value authority actions (custodial signing)

1. An authority official initiates a resolution or endorsement action.
2. `packages/authority-node` `AuditLayer` sends an OTP to the official's registered mobile.
3. On successful OTP verification, `CustodialSigner` signs and submits the Fabric transaction on behalf of the authority org.
4. The audit metadata (timestamp, IP, official ID) is bundled into the chaincode payload for legal non-repudiation.

### 4. Public analytics and map browsing

1. Anonymous users open the public dashboard or map in `frontend`.
2. The UI reads the gateway public routes under `/public`.
3. Public endpoints aggregate complaint counts, chronic roads, hotspots, trends, contractor scorecards, districts, states, and road GeoJSON.

### 5. RTI workflow

1. A user creates or edits an RTI request through `apps/gateway-api`.
2. The gateway calculates statutory deadlines, stores the request, and persists RTI events.
3. The requester can fetch the RTI by token, upload evidence, attach files, escalate, and download a zipped evidence bundle.

### 6. Background maintenance

1. `services/scheduler` runs continuous cron jobs.
2. It syncs the offline queue, recalculates karma, checks SLA breaches, prunes old audit logs, and generates daily reports.

### 7. Mobile offline-first sync

1. `apps/mobile-host` uses local SQLite and encrypted storage for complaint drafts, agent memory, and tokens.
2. When connectivity returns, the mobile client pushes complaint data back to the gateway.

---

## Service Responsibilities In One Line

- `apps/gateway-api` — owns the main authenticated API and realtime behavior.
- `frontend` — owns the browser UX for citizen, authority, contractor, and super-admin routes.
- `apps/mobile-host` — owns the React Native host shell, onboarding, map, complaint, and agent surfaces.
- `backend-api` — owns the auxiliary complaint/image ingestion and analytics support surface.
- `services/fabric-anchor-consumer` — owns complaint anchoring and Merkle proof persistence.
- `services/webhook-handler` — owns Kafka side effects and downstream state writes.
- `services/scheduler` — owns recurring maintenance and SLA jobs.
- `services/media-ingest` — prototype media ingestion; opt-in via `--profile media`.
- `chaincode` — owns on-ledger complaint lifecycle and evidence/proof queries.
- `packages/kafka` — owns the KafkaJS client singleton and producer.
- `packages/redis` — owns the ioredis client, idempotency key claiming, and backpressure.
- `packages/authority-node` — owns custodial Fabric signing, OTP audit layer, and org cert management.
- `packages/core` — owns shared domain models, escalation engine, and AI prompt templates.
- `packages/providers` — owns all infrastructure adapters (storage, streaming, map, AI, media, Fabric).

---

## What Changed Since Last Snapshot (May 22, 2026)

### Structure changes — 4-layer enforcement

- `start-all.sh`, `stop-all.sh`, `start.ps1` moved from repo root → `ops/dev/`
- `scripts/setup.ps1` moved → `ops/dev/setup.ps1`; `ops/dev/setup.ps1` path anchor fixed (was one level off)
- `scripts/backfill-embeddings-to-vector.js`, `scripts/migrate-postgres-to-cassandra.js` moved → `ops/tools/`
- `services/fabric-anchor-consumer/produce-test-events.ts` moved → `tools/` (dev tooling, not production service code)
- `services/media-ingest/docker-compose.yml` eliminated; service merged into root `docker-compose.yml` as `--profile media`

### Package.json script fixes

- `setup` / `setup:skip-install` → now point to `ops/dev/setup.ps1`
- `k8s:up` / `k8s:reset` → now point to `ops/deploy/deploy-kind.ps1` (were incorrectly pointing to a non-existent `k8s/deploy-kind.ps1`)

### Workspace orphan resolution

- `core/` (root, not in workspace) → deleted; contents migrated to `packages/core/src/escalation/` and `packages/core/src/prompts/`
- `providers/kafka/` (root, not in workspace) → moved to `packages/kafka/`; registered as `@roadwatch/kafka`
- `providers/redis/` (root, not in workspace) → moved to `packages/redis/`; registered as `@roadwatch/redis`
- `providers/fabric/FabricProvider.ts` → moved to `packages/providers/src/fabric-provider/`
- `authority-node/` (root, no `package.json`) → moved to `packages/authority-node/`; wired as `@roadwatch/authority-node`
- `pnpm-workspace.yaml` updated: removed dead `providers/*` glob, added `packages/kafka`, `packages/redis`, `packages/authority-node`

### Gitignore additions

- `bin/`, `.pids/`, `logs/`, `config_block.json`, `config_block.pb`, `core.yaml` added to `.gitignore`

---

## Where To Read Next

- `docs/services/gateway-api/README.md`
- `docs/services/authority-portal/README.md`
- `docs/services/mobile-host/README.md`
- `docs/services/chaincode/README.md`
- `docs/services/fabric-anchor-consumer/README.md`
- `docs/services/backend-api/README.md`
- `docs/services/scheduler/README.md`
- `docs/services/webhook-handler/README.md`
- `docs/services/packages/shared-packages.md`
