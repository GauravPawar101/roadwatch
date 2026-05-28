# RoadWatch - Citizen Complaint Management System

A comprehensive blockchain-enabled platform for managing road infrastructure complaints with real-time analytics, authority workflows, and citizen engagement.

## 📚 Documentation

All documentation is organized in the [`docs/`](./docs/) folder:

- **[Getting Started](./docs/infrastructure/setup-checklist.md)** - Complete setup guide
- **[System Overview](./docs/README.md)** - Architecture and services
- **[API Documentation](./docs/services/)** - Service-specific guides
- **[Infrastructure](./docs/infrastructure/)** - Docker, deployment, and operations
- **[Implementation Guides](./docs/implementation/)** - Feature implementations

## 🚀 Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start infrastructure
docker compose --profile kafka up -d

# 3. Seed demo data
pnpm seed:demo

# 4. Start development servers
pnpm dev
```

## 🏗️ Architecture

- **Gateway API** - Central REST API backend
- **Authority Portal** - React web dashboard for authorities  
- **Mobile App** - React Native citizen app
- **Blockchain** - Hyperledger Fabric for immutable audit trails
- **Event Streaming** - Kafka for real-time processing

## 📊 Key Features

- **Public Analytics** - Citizen-facing dashboard at `/public`
- **Real-time Updates** - Live complaint tracking and notifications
- **Blockchain Anchoring** - Immutable complaint history
- **Multi-role Access** - Citizens, authorities, contractors, admins
- **Offline Support** - Mobile app works without connectivity

## 🔗 Quick Links

- Analytics: `GET /public/dashboard`
- Complaint Tracking: `GET /public/chronic-roads?days=60`
- Ministry Reports: `GET /reports/ministry.pdf` (requires `CE` role)

## 🛠️ Development

- Run everything: `pnpm dev`
- Gateway API only: `pnpm --filter @roadwatch/gateway-api dev`
- Frontend only: `pnpm --filter roadwatch-frontend dev`

## Local development ports

- **PgBouncer (host)**: 127.0.0.1:6432  (containers use `pgbouncer:6432`)
- **PostgreSQL (host)**: 127.0.0.1:5433  (containers use `postgres:5432`)
- **Zookeeper (host)**: 127.0.0.1:2181
- **Kafka (host)**: 127.0.0.1:9094  (containers use `kafka:29092`)
- **Redis (host)**: 127.0.0.1:16379  (containers use `redis:6379`)
- **Gateway API**: http://localhost:3100
- **Backend API**: http://localhost:4001  (if port 4001 is blocked on Windows, `start-all.ps1` will fall back to `5001` and set `BACKEND_PORT` accordingly)
- **Frontend (Vite)**: http://localhost:5173

Tip: use `start-all.ps1` on Windows or `pnpm dev` to launch everything; `start-all.ps1` now detects a usable `BACKEND_PORT` and exports it for the backend process.

## Safe start / stop behavior

Start/stop scripts and docs now prefer non-destructive operations by default to avoid accidental data loss:

- To stop containers but preserve volumes/data: `docker compose stop` or use the project stop scripts.
- To restart services: `docker compose up -d` (or `./start-all.sh` / `start-all.ps1`).
- For Fabric: `fabric/network/scripts/start.sh` preserves generated artifacts by default; pass `--reset` to perform a full teardown and regenerate artifacts.
- For sample token networks and other scripts that previously used `down -v`, use `docker compose down --volumes` only when you intentionally want to remove volumes/artifacts.

Be cautious with `docker compose down --volumes` — it deletes persistent data (identities, DB files, blocks).

## Local Fabric (dev)

From `fabric/network/`:

- Start the network + create/join the `roadwatch-india` channel:
   - `./scripts/start.sh`
- Deploy chaincode (package → install → approve → commit):
   - `./scripts/deploy-chaincode.sh`

Defaults:
- `FABRIC_CHANNEL=roadwatch-india`
- `FABRIC_CHAINCODE=complaint-anchor`

If you change chaincode code and want to redeploy, bump at least one of:
- `FABRIC_CC_VERSION` (default `0.0.1`)
- `FABRIC_CC_SEQUENCE` (default `1`)

Optional (seeds some test data):
- `FABRIC_CC_INVOKE_INIT_LEDGER=1 ./scripts/deploy-chaincode.sh`

Notes about CouchDB (rich queries):

- This repository now defaults the Fabric peer state database to CouchDB so chaincode can use Mango rich queries (used by `complaint-anchor` for `GetEscalationHistory`).
- Control the ledger state DB with `FABRIC_LEDGER_STATE_DB` in `fabric/network/.env` (values: `CouchDB` or `goleveldb`). The default is `CouchDB`.
- The network `start.sh` script automatically enables the Docker Compose `couchdb` profile when `FABRIC_LEDGER_STATE_DB=CouchDB` so CouchDB containers are started. To force LevelDB, set `FABRIC_LEDGER_STATE_DB=goleveldb` before running the start script.
- Ensure the chaincode package includes `META-INF/statedb/couchdb/indexes/*.json` index files for any Mango selectors; an index for `complaintId`/`timestamp` is provided at `fabric/chaincode/complaint-anchor/META-INF/statedb/couchdb/indexes/complaintid_timestamp_index.json`.

Local env/credentials mapping (incl. dev OTP → JWT for authority tool calls): `docs/test-credentials.md`

## Fabric anchor consumer

This service consumes `complaint.submitted` events from Kafka, anchors a Merkle root to Fabric, and only then commits offsets.

1) Copy env template: `services/fabric-anchor-consumer/.env.example` → `services/fabric-anchor-consumer/.env`
2) Run: `pnpm --filter @roadwatch/fabric-anchor-consumer dev`

# Onboarding & seeding

- Ops doc: `docs/onboarding-ops.md`
- Seed demo data into Postgres: `pnpm seed:demo`
- Deterministic test IDs (roads/complaints/regions): `scripts/test-ids.env` (export or copy into your `.env`)
- Seed deterministic complaints into Fabric (requires `FABRIC_*` env vars): `pnpm seed:fabric`
- Query Fabric complaint history (defaults to `RW_TEST_COMPLAINT_ID_1`): `pnpm query:fabric:history`
- Query Fabric complaints by road (defaults to `RW_TEST_ROAD_ID_1`): `pnpm query:fabric:by-road`

# Fabric Network Design

## Org Topology
- **CitizenOrg**: Runs API gateway, peer node for complaint submission, manages citizen identities.
- **NHAIOrg**: Runs peer node for National Highways, manages NHAI officials.
- **PWDOrg**: Runs peer node for state roads, manages PWD officials.
- **AuditOrg**: Runs peer node for independent audit, monitors all transactions.

## Channel Design
- **Single Channel (roadwatch-channel)**: All orgs participate for maximum transparency and cross-org workflow.
- For multi-country: one channel per country (e.g., india-channel, kenya-channel).
- For large deployments: consider sub-channels per state or authority for data isolation.

## Chaincode (Smart Contract) Functions
- File complaint, update status, resolve, escalate, query by road, get history, anchor escalation events, etc.
- All business logic for complaint lifecycle, escalation, audit, and authority actions.

## Endorsement Policy
- Complaint creation: CitizenOrg + NHAIOrg (or PWDOrg) must endorse.
- Resolution: NHAIOrg (or PWDOrg) + AuditOrg must endorse.
- Policy is set in chaincode definition and channel config.

## MSP (Membership Service Provider) Setup
- Each org has its own MSP, managed by its Fabric CA.
- Identities (X.509 certs) are issued per org and mapped to roles (citizen, engineer, auditor, etc).

## Ordering Service
- Raft-based ordering service for high availability.
- Minimum 3 orderer nodes (recommend 5 for production resilience).
- Orderers can be run by a neutral org (e.g., AuditOrg) or distributed among all orgs.

## Private Data Collections
- Citizen PII (phone, email, etc) is stored in a private data collection accessible only to CitizenOrg.
- Chaincode enforces PII never appears in public ledger state.
- Use Fabric's collection config to define access policies.

## Fabric CA Design
- Each org runs its own Fabric CA for identity issuance and revocation.
- Root CA per org, with intermediate CAs for scaling if needed.
# RoadWatch Multi-Org Fabric Topology

## Organizations
- **CitizenOrg**: Handles citizen API, complaint submission, JWT issuance
- **NHAIOrg**: National Highways Authority, main authority for NH
- **PWDOrg**: Public Works Department, handles state roads
- **AuditOrg**: Independent audit and compliance

## Topology
- Each org runs its own Fabric peer and CA
- Chaincode is installed on all peers
- Channels: one main channel (roadwatch-channel)
- Endorsement policy: e.g., NHAIOrg & AuditOrg must sign for resolution

## Secure Certificate Handling
- Org certificates/keys are stored in secure vaults or HSM in production
- Never hardcode private keys in code or config

---

## Event Pipeline
- Complaint submitted (REST) → Fabric transaction (CustodialSigner) → Kafka event → Push notification (FCM/SMS)
- Webhook endpoint receives Fabric state changes for real-time updates

---

## Rate Limiting
- REST endpoints are rate-limited per IP/user to prevent spam and protect Fabric

---

## Error Handling
- All gateway→Fabric calls have retry logic and structured error responses
# 🔑 Infrastructure Keys & Provisioning Strategy

To compile and securely execute the RoadWatch edge pipeline architecture natively locally, you must explicitly provision safe sandbox keys across three distributed platforms inherently natively. All platforms provide fundamentally massive mathematically generous free-tiers cleanly natively!

---

### 1. Google Gemini Edge (AI Logic Processing)
*Because RoadWatch locally simulates agent-execution chains structurally natively, Google AI Studio generates mathematical text-boundaries locally efficiently.*

1. Navigate to **[Google AI Studio](https://aistudio.google.com/)**.
2. Locate the navigation sidebar and click **"Get API key"**.
3. Select **Create API Key in new project**. Copy the exact string into `apps/mobile-host/.env` physically gracefully.
4. **🛡️ Edge Restriction Limits (Production Only)**: Because this key sits completely exposed inside the React Native bundle logically natively, you **must** strictly visit the Google Cloud Console API restrictions page perfectly mapping the key securely restricted *only* to your Android certificate SHA-1 fingerprint natively geographically explicitly, and your physical iOS Bundle ID (`com.roadwatch.app`).

#### Gateway API (LangGraph agent inference)

RoadWatch also supports server-side agent inference via a LangGraph pipeline in `apps/gateway-api`.

- Endpoint: `POST /public/agent/chat` with JSON `{ "input": "...", "system"?: "..." }`
- Primary model: Gemini (REST)
- Fallbacks: Ollama (`/api/chat`) and/or a llama.cpp server exposing an OpenAI-compatible `POST /v1/chat/completions`

Set these env vars for `apps/gateway-api`:

- `GEMINI_API_KEY` (optional if using only fallbacks)
- `GEMINI_MODEL` (default: `gemini-2.0-flash`)
- `GEMINI_API_BASE_URL` (default: `https://generativelanguage.googleapis.com/v1beta`)
- `OLLAMA_BASE_URL` (e.g. `http://ollama-host:11434`)
- `OLLAMA_MODEL` (default: `llama3.1`)
- `LLAMACPP_BASE_URL` (e.g. `http://llama-server:8080`)
- `LLAMACPP_MODEL` (default: `llama`)
- `LLM_FALLBACK_ORDER` (default: `gemini,ollama,llamacpp`)

### 2. Supabase Storage and Auth
*Supabase now handles the media bucket and auth client settings for the mobile app and upload paths.*

1. Create or reuse a **Supabase Project** and a public bucket for complaint media.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the app env files.
3. Set `SUPABASE_STORAGE_BUCKET` to the bucket name used for uploads.
4. If your bucket is public, clients can derive the public URL from `SUPABASE_URL` plus the bucket name.
