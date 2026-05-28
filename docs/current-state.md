# RoadWatch Current State

**Snapshot date:** May 22, 2026

This document is the current source of truth for what is in the repository now, what each service does, which versions are pinned, and how the main flows connect end to end.

## Repo Baseline

- Package manager: `pnpm@8.10.0`
- Monorepo orchestration: `turbo`
- Primary shared language: TypeScript `^5.8.3` for most workspace packages
- Main backend stack: Express `4.21.2`, PostgreSQL, Kafka, Hyperledger Fabric
- Main web stack: React `18.2.0` with Vite `5.4.21`
- Main mobile stack: React Native `0.73.0`

## What Is In The Repo Now

### Active app surfaces

- `apps/gateway-api`: primary authenticated API, realtime SSE, auth, public dashboards, RTI, reports, notifications, AI agent endpoint.
- `frontend`: browser dashboard and public/citizen web app.
- `apps/mobile-host`: React Native mobile host with offline-first complaint, map, and agent screens.
- `backend-api`: auxiliary complaint/image/analytics backend that shares the gateway database and emits complaint events.

### Background and integration services

-- `services/fabric-anchor-consumer`: consumes `complaint-submitted`, batches Merkle roots, and anchors them to Fabric.
- `services/webhook-handler`: consumes Kafka topics and applies state changes, notification writes, and audit logging.
- `services/scheduler`: cron-based maintenance and housekeeping service.
- `services/media-ingest`: legacy/prototype media submission backend, not wired into the main root runtime.

### Blockchain and shared packages

- `chaincode`: Hyperledger Fabric chaincode package.
- `providers/kafka` and `providers/redis`: message and cache adapters.
- `packages/core`, `packages/config`, `packages/features`, `packages/providers`, `packages/adapters`, `packages/test-utils`, `packages/providers/storage-sqlite`: shared workspace packages.

## Version Matrix

| Surface | Version / Pins | Role | State |
|---|---|---|---|
| Root workspace | `pnpm@8.10.0` | Monorepo package manager | Active |
| `apps/gateway-api` | private package, TS, Express `4.21.2`, JWT `9.0.2`, Zod `3.25.76`, Multer `1.4.5-lts.2`, Pg `8.13.1`, LangGraph `0.4.3` | Main API and flow orchestrator | Active |
| `frontend` | React `18.2.0`, Vite `5.4.21`, `@vitejs/plugin-react` `5.1.4`, React Router `6.14.1`, TanStack Query `5.100.10`, Recharts `2.15.4`, Zustand `5.0.13` | Browser dashboard / citizen web app | Active |
| `apps/mobile-host` | React Native `0.73.0`, React Navigation `6.1.18`/`6.11.0`, `react-native-quick-sqlite` `8.1.0`, `react-native-keychain` `9.2.0` | Mobile host shell | Active |
| `backend-api` | Express `4.21.2`, `express-rate-limit` `7.5.1`, JWT `9.0.2`, Pg `8.13.1` | Complaint, analytics, webhook and image submission support | Active / auxiliary |
| `services/fabric-anchor-consumer` | Fabric Gateway `1.9.1`, KafkaJS `2.2.4`, Pg `8.13.1` | Batch anchor complaints to Fabric | Active |
| `services/webhook-handler` | KafkaJS `2.2.4`, Axios `1.7.7`, Pg `8.13.1` | Kafka topic consumer and side-effect writer | Active |
| `services/scheduler` | `node-cron` `3.0.3`, Pg `8.13.1` | Scheduled maintenance and SLAs | Active |
| `chaincode` | Fabric Contract API `2.5.8`, Fabric Shim `2.5.8` | On-ledger complaint lifecycle and query logic | Active |
| `providers/kafka` | KafkaJS `2.2.4` | Kafka abstraction | Active |
| `providers/redis` | ioredis `5.10.1` | Redis abstraction | Active |
| `packages/core` | internal `0.0.0` | Shared business logic | Active |
| `packages/config` | internal `0.0.0` | Shared configuration | Active |
| `packages/features/*` | `feature-complaint` `1.0.0`, others `0.0.0` | Reusable UI feature modules | Active |
| `packages/providers/storage-sqlite` | `1.0.0` | Mobile local storage | Active |
| `services/media-ingest` | `0.1.0` | Legacy media prototype | Prototype / not wired into root compose |

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

### 3. Public analytics and map browsing

1. Anonymous users open the public dashboard or map in `frontend`.
2. The UI reads the gateway public routes under `/public`.
3. Public endpoints aggregate complaint counts, chronic roads, hotspots, trends, contractor scorecards, districts, states, and road GeoJSON.
4. The frontend renders maps and dashboards without requiring a login.

### 4. RTI workflow

1. A user creates or edits an RTI request through `apps/gateway-api`.
2. The gateway calculates statutory deadlines, stores the request, and persists RTI events.
3. The requester can fetch the RTI by token, upload evidence, attach files, escalate, and download a zipped evidence bundle.
4. RTI is intentionally separate from complaint lifecycle state.

### 5. Notifications flow

1. Gateway and webhook-handler write notification records as events occur.
2. `apps/gateway-api` exposes inbox, preference, and topic endpoints.
3. The client reads notification topics and inbox records.
4. `services/webhook-handler` also records delivery-related side effects for Kafka-triggered notifications.

### 6. Background maintenance

1. `services/scheduler` runs continuous cron jobs.
2. It syncs the offline queue, recalculates karma, checks SLA breaches, prunes old audit logs, and generates daily reports.
3. These jobs keep the complaint and reporting data consistent without user interaction.

### 7. Authority onboarding and geography setup

1. A CE user uses `/admin` routes in the gateway.
2. The gateway creates users, contractors, countries, states, districts, roads, road assignments, and authority directory records.
3. The public dashboard and authority dashboard then read from the same data model.

### 8. Mobile offline-first sync

1. `apps/mobile-host` starts on the onboarding or map flow.
2. It uses local SQLite and encrypted storage for complaint drafts, agent memory, and tokens.
3. When connectivity returns, the mobile client pushes complaint data back to the gateway.
4. The dashboard later reflects the synced complaint state.

### 9. Image submission and verification

1. `backend-api` exposes image submission and complaint creation support routes.
2. It enforces nonce freshness, geofence checks, duplicate detection, and karma-based limits.
3. It stores attachments, audit entries, and verification rows.
4. It emits complaint events that can be picked up by the rest of the pipeline.

### 10. Fabric anchoring and proof storage

1. `services/fabric-anchor-consumer` reads complaint submissions from Kafka.
2. It stores idempotency state and proof tables in PostgreSQL.
3. It sends the anchor transaction to Fabric using the `complaint-anchor` chaincode.
4. After commit confirmation, it publishes `complaint-anchored` with the Fabric transaction id and proof data.

## Service Responsibilities In One Line

- `apps/gateway-api`: owns the main authenticated API and realtime behavior.
- `frontend`: owns the browser UX for citizen, authority, contractor, and super-admin routes.
- `apps/mobile-host`: owns the React Native host shell, onboarding, map, complaint, and agent surfaces.
- `backend-api`: owns the auxiliary complaint/image ingestion and analytics support surface.
- `services/fabric-anchor-consumer`: owns complaint anchoring and Merkle proof persistence.
- `services/webhook-handler`: owns Kafka side effects and downstream state writes.
- `services/scheduler`: owns recurring maintenance and SLA jobs.
- `chaincode`: owns on-ledger complaint lifecycle and evidence/proof queries.
- `providers/*`: owns infrastructure adapters.
- `packages/*`: owns shared domain, configuration, UI feature modules, and test utilities.

## Notes On Current State

- The root Docker and service orchestration has already shifted to local Kafka + Zookeeper rather than Upstash for the main runtime path.
- `services/media-ingest` remains a separate prototype with its own compose file and should be treated as legacy unless it is explicitly re-integrated.
- `backend-api` and `apps/gateway-api` overlap in some complaint and media concepts, so the gateway API should be treated as the primary contract for the main app while `backend-api` is the auxiliary path.
- `service-verification.md` and `service-inventory.md` are still useful references, but this document is the current top-level summary.

## Where To Read Next

- `docs/services/gateway-api/README.md`
- `docs/services/authority-portal/README.md`
- `docs/services/mobile-host/README.md`
- `docs/services/chaincode/README.md`
- `docs/services/fabric-anchor-consumer/README.md`
- `docs/services/backend-api/README.md`
- `docs/services/scheduler/README.md`
- `docs/services/webhook-handler/README.md`