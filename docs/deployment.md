# RoadWatch deployment (free-tier friendly)

This repo contains multiple moving parts. A “full pipeline” typically means:

- Web frontend: `apps/authority-portal` (Vite)
- API backend: `apps/gateway-api` (Express + Postgres)
- Event pipeline: Kafka topics (best via Upstash Kafka)
- Fabric anchoring: `services/fabric-anchor-consumer` (consumes Kafka, anchors Merkle roots to Fabric)
- Hyperledger Fabric network: `fabric/network` (orderer + peers + couchdb)

## Recommended free-tier layout

### What to deploy where

- **Frontend (web)**: Vercel (free Hobby) ✅
- **API + long-running workers + Fabric**: one **always-free VM** (recommended: Oracle Cloud “Always Free” compute)
- **Postgres**: either
  - **Managed free Postgres** (recommended): Neon or Supabase, OR
  - Postgres on the same VM (simpler accounts, heavier VM)
- **Kafka**: **Upstash Kafka (REST)** free tier (works well with this repo)
- **Redis (optional)**: **Upstash Redis (REST)** free tier (used for idempotency/dedupe)
- **Public HTTPS for the API**: Cloudflare Tunnel (free) or a reverse proxy on the VM

Why this split: serverless platforms are great for the frontend, but **Fabric + Kafka consumers require always-on processes and stable networking**.

## Step-by-step

### 1) Create the managed services (free)

#### A) Upstash Kafka (REST)
Create a Kafka database in Upstash and copy the REST API credentials.

You will need **one** of these auth sets:

- `UPSTASH_KAFKA_REST_URL` + `UPSTASH_KAFKA_REST_TOKEN` (common in the UI)
- OR `UPSTASH_KAFKA_REST_URL` + `UPSTASH_KAFKA_REST_USERNAME` + `UPSTASH_KAFKA_REST_PASSWORD`

This repo supports either form.

#### B) Upstash Redis (REST) (optional)
If you configure Redis, the API will use it for **idempotent Kafka publishing** (dedupe across retries).

Set:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

#### C) Database (choose one)

- **Cassandra (recommended)**: Use a managed or local Cassandra cluster. Set the following env vars for the API and services:
  - `CASSANDRA_CONTACT_POINTS=cassandra:9042`
  - `CASSANDRA_KEYSPACE=roadwatch`
  - `CASSANDRA_LOCAL_DC=datacenter1`

- **Postgres (legacy / unsupported)**: The codebase has fully migrated to Cassandra as the primary database. Postgres support is no longer maintained for most runtime code; legacy scripts may still work with `DATABASE_URL` but new development should use Cassandra.

### 2) Create an always-free VM (recommended: Oracle Cloud)

Create a small Ubuntu VM (Arm is fine). You’ll run:

- Fabric network containers
- `apps/gateway-api`
- `services/fabric-anchor-consumer`

Install prerequisites:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Docker Compose plugin (usually included with modern Docker installs)
docker compose version
```

Re-login after adding yourself to the `docker` group.

### 3) Deploy Fabric network on the VM

On the VM:

```bash
git clone <your repo url>
cd roadWatch/fabric/network
./scripts/start.sh
```

This script:

- generates crypto material under `fabric/network/organizations/`
- starts orderer + peers + couchdb via `fabric/network/docker/docker-compose.yaml`
- creates channel `roadwatch-india`
- deploys chaincode (defaults: `complaint-anchor`)

If you re-deploy chaincode, bump one of:

- `FABRIC_CC_VERSION`
- `FABRIC_CC_SEQUENCE`

### 4) Configure and run the API (gateway-api)

On the VM, copy the template and fill real values:

- Copy: `apps/gateway-api/.env.example` → `apps/gateway-api/.env`

Minimum production set (Cassandra preferred):

- `NODE_ENV=production`
- `PORT=3000`
- `CASSANDRA_CONTACT_POINTS=cassandra:9042`
- `CASSANDRA_KEYSPACE=roadwatch`
- `CASSANDRA_LOCAL_DC=datacenter1`
- `JWT_SECRET=...` (strong random)

Strongly recommended for production PII handling:

- `PHONE_HASH_PEPPER=...`
- `PHONE_ENC_KEY=...` (base64 32-byte key)

Optional but common:

- Kafka via Upstash: `UPSTASH_KAFKA_REST_URL` + (`UPSTASH_KAFKA_REST_TOKEN` or `UPSTASH_KAFKA_REST_USERNAME/PASSWORD`)
- Notifications (Twilio/MSG91/FCM) if you enable the dispatcher

Run the service:

```bash
cd roadWatch
corepack enable
pnpm install --frozen-lockfile

pnpm --filter @roadwatch/gateway-api build
pnpm --filter @roadwatch/gateway-api start
```

For keeping it alive on reboot, use `systemd` (recommended) or a process manager (pm2).

### 5) Configure and run fabric-anchor-consumer

This service reads from Kafka and anchors to Fabric.

- Copy: `services/fabric-anchor-consumer/.env.example` → `services/fabric-anchor-consumer/.env`

Required env vars:

- Kafka (Upstash REST): `UPSTASH_KAFKA_REST_URL`, `UPSTASH_KAFKA_REST_USERNAME`, `UPSTASH_KAFKA_REST_PASSWORD` (or token variant)
  - `CASSANDRA_CONTACT_POINTS` (same DB is fine)
  - `CASSANDRA_KEYSPACE`
  - `CASSANDRA_LOCAL_DC`
- Fabric gateway material:
  - `FABRIC_TLS_CERT_PATH`
  - `FABRIC_PEER_ENDPOINT`
  - `FABRIC_PEER_HOST_ALIAS`
  - `FABRIC_CHANNEL_NAME`
  - `FABRIC_CHAINCODE_NAME`
  - `FABRIC_X509_CERT_PATH`
  - `FABRIC_X509_KEY_PATH`

Run it:

```bash
cd roadWatch
pnpm --filter @roadwatch/fabric-anchor-consumer dev
```

(Despite the name, this is a single-run process; it does not watch files.)

### 6) Expose the API over HTTPS (recommended: Cloudflare Tunnel)

Vercel sites are served over HTTPS; to avoid mixed-content issues your API should be reachable over **HTTPS** too.

Cloudflare Tunnel is the easiest free option:

- Create a Cloudflare account
- Add a domain (or use a free subdomain if you have one)
- Install `cloudflared` on the VM
- Create a tunnel and route `https://api.your-domain.com` → `http://localhost:3100`

### 7) Deploy the web frontend to Vercel

Project: `apps/authority-portal`

In Vercel → **New Project** → Import your Git repo:

- **Root Directory**: `apps/authority-portal`
- **Framework Preset**: Vite
- **Install Command**: `pnpm install --frozen-lockfile`
- **Build Command**: `pnpm -w --filter @roadwatch/authority-portal build`
- **Output Directory**: `dist`

Add an environment variable:

- `VITE_API_BASE` = `https://api.your-domain.com` (your tunneled API URL)

Deploy.

## Secrets / env var matrix (what goes where)

### Frontend (Vercel) — public build-time vars

- `VITE_API_BASE`
  - **Where**: Vercel Project → Settings → Environment Variables
  - **Value**: `https://api.<your-domain>`
  - **Note**: Anything `VITE_*` becomes public in the built JS bundle.

### API backend (VM env) — MUST stay private

- Core:
-
- `CASSANDRA_CONTACT_POINTS` (managed or local Cassandra)
- `CASSANDRA_KEYSPACE`
- `CASSANDRA_LOCAL_DC`
- `JWT_SECRET` (generate strong random)

PII protection (recommended):

- `PHONE_HASH_PEPPER` (random string)
- `PHONE_ENC_KEY` (base64-encoded 32 bytes)

Kafka (if using Upstash):

- `UPSTASH_KAFKA_REST_URL`
- `UPSTASH_KAFKA_REST_TOKEN` (or `UPSTASH_KAFKA_REST_USERNAME` + `UPSTASH_KAFKA_REST_PASSWORD`)

LLM (optional):

- `GEMINI_API_KEY` (if using Gemini)

Notifications (optional):

- `FCM_SERVER_KEY` (server-side only)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`
- `TWILIO_WHATSAPP_FROM`

### Fabric anchor consumer (VM env) — MUST stay private

Kafka:

- Same `UPSTASH_KAFKA_REST_*` as above

Fabric gateway:

- `FABRIC_TLS_CERT_PATH`
- `FABRIC_X509_CERT_PATH`
- `FABRIC_X509_KEY_PATH`
- `FABRIC_PEER_ENDPOINT`, `FABRIC_PEER_HOST_ALIAS`
- `FABRIC_CHANNEL_NAME`, `FABRIC_CHAINCODE_NAME`

Important: these are **file paths on the VM** (or mounted into a container). Do not put certs/keys into Vercel.

## Generating strong secrets

On Linux/macOS:

```bash
# JWT secret (base64)
openssl rand -base64 48

# Phone hash pepper (hex)
openssl rand -hex 32

# AES-256-GCM key (32 bytes, base64)
openssl rand -base64 32
```

On Windows PowerShell:

```powershell
# 48 bytes -> base64
[Convert]::ToBase64String((1..48 | ForEach-Object {Get-Random -Max 256}))

# 32 bytes -> base64
[Convert]::ToBase64String((1..32 | ForEach-Object {Get-Random -Max 256}))
```

## Notes / gotchas

- SSE endpoint (`/events`) works best on an always-on VM (serverless platforms often time out long-lived connections).
- In production, set `ALLOW_DEV_OTP_ECHO=false`.
- Keep Fabric peer/orderer ports private if possible; prefer running Fabric on the VM and only exposing the HTTP API.
