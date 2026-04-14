# Public analytics & reporting

Citizen-facing (no-login) analytics is implemented in the gateway API under `/public/*`, and rendered in the authority portal at `/public`.

- Analytics model + storage: `docs/analytics-system.md`
- Ministry report PDF layout: `docs/ministry-report-format.md`

Key endpoints:

- `GET /public/dashboard`
- `GET /public/chronic-roads?days=60`
- `GET /public/hotspots`
- `GET /public/trends`
- `GET /public/contractors/scorecard`
- `GET /public/export/roads.csv` | `GET /public/export/roads.geojson` | `GET /public/export/roads.pdf`
- `GET /reports/ministry.pdf` (requires `CE` role)

Dev commands:

- Run everything: `pnpm dev`
- Gateway API only: `pnpm --filter @roadwatch/gateway-api dev`
- Authority portal only: `pnpm --filter @roadwatch/authority-portal dev`

Local env/credentials mapping (incl. dev OTP → JWT for authority tool calls): `docs/test-credentials.md`

## Fabric anchor consumer

This service consumes `complaint.submitted` events from Kafka, anchors a Merkle root to Fabric, and only then commits offsets.

1) Copy env template: `services/fabric-anchor-consumer/.env.example` → `services/fabric-anchor-consumer/.env`
2) Run: `pnpm --filter @roadwatch/fabric-anchor-consumer dev`

# Onboarding & seeding

- Ops doc: `docs/onboarding-ops.md`
- Seed regions + road index into Postgres: `pnpm seed:backend -- --file apps/gateway-api/scripts/seeds/india-demo.json`
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

### 2. Cloudflare R2 arrays (S3-Compatible Web Media Edge Storage)
*R2 securely maps physical video queues completely globally cleanly bypassing rigid Postgres blobs magically effectively natively.*

1. Navigate to your **[Cloudflare Dashboard](https://dash.cloudflare.com)** dynamically inherently natively.
2. Select **R2** from the left-hand control array intuitively safely, and mathematically initialize a bucket named `roadwatch-media-matrices`.
3. Locate and click **"Manage R2 API Tokens"** structurally inherently.
4. Click **Create API Token**, select **Read & Write** bounds explicitly gracefully cleanly, and dynamically natively commit.
5. Cloudflare will instantaneously explicitly globally expose exactly two secrets gracefully natively. **Extract solely the S3-compatible tokens**: the `Access Key ID` and the physical `Secret Access Key`.
6. Embed these securely structurally exactly inside `docker/.env` physically natively! *(Never expose these globally inside the mobile application).*

### 3. Supabase Caches (PostgreSQL Authentications logically implicitly)
*While the Custom Express API natively serves your structural logic, Supabase mechanically serves globally structural mathematical auth matrices strictly cleanly cleanly.*

1. Head directly to the **[Supabase Dashboard](https://supabase.com/dashboard/)**.
2. Mathematically map purely initializing a generic new Free Project structurally. 
   *(**Crucial**: Memorize the precise "Database Password" you physically type here globally natively! This must cleanly universally explicitly map sequentially identically into your `docker/.env` secret `POSTGRES_PASSWORD` variable!)*
3. Navigate structurally purely explicitly over into **Project Settings -> API** mechanically automatically.
4. Collect the standard geometric string boundaries perfectly natively implicitly:
   * Copy the **Project URL** cleanly across into both `.env` matrices safely globally inherently natively.
   * Copy the **`anon` / `public` Key** uniquely down completely flawlessly implicitly into your `apps/mobile-host/.env` configuration structurally mapping local RBAC inherently cleanly smoothly dynamically!
