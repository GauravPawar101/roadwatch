# Setup

Step-by-step guide to get RoadWatch running from a clean checkout.

## 1. Clone and install

```powershell
git clone <repo-url> roadwatch
cd roadwatch
pnpm install
```

pnpm workspaces install all apps, services, and packages from the root.

## 2. Copy environment files

```powershell
# Root (optional — used by some scripts)
Copy-Item .env.example .env

# Gateway API (required)
Copy-Item apps/gateway-api/.env.example apps/gateway-api/.env

# Backend API (optional — inherits gateway secrets when present)
Copy-Item backend-api/.env.example backend-api/.env

# Fabric anchor consumer (required for anchoring)
Copy-Item services/fabric-anchor-consumer/.env.example services/fabric-anchor-consumer/.env

# Mobile (optional)
Copy-Item apps/mobile-host/.env.example apps/mobile-host/.env
```

Edit `apps/gateway-api/.env` at minimum. Set `DATABASE_URL`, `JWT_SECRET`, and Kafka/Redis URLs. See [Environment variables](./environment-variables.md).

## 3. Start infrastructure

```powershell
docker compose up -d
```

This starts Postgres, PgBouncer, dual Kafka clusters, Redis, and background workers (scheduler, webhook-handler, fabric-anchor-consumer). No profiles are required for the default stack.

Optional media ingest service:

```powershell
docker compose --profile media up -d
```

## 4. Initialize Kafka topics (first run)

```powershell
pwsh -File scripts/init-messaging.ps1
```

## 5. Seed demo data

```powershell
pnpm seed:demo
```

This populates Postgres with demo users, roads, and complaints. Login credentials are in [Test credentials](../reference/test-credentials.md).

## 6. Start application servers

**Option A — one command (recommended on Windows):**

```powershell
pnpm start:all
# or
.\ops\dev\start-all.ps1
```

**Option B — Turbo dev (all Node apps in parallel):**

```powershell
pnpm dev
```

**Option C — individual services:**

```powershell
pnpm dev:api        # Gateway API on :3100
pnpm dev:backend    # Backend API on :4001
pnpm dev:frontend   # Frontend on :5173
```

## 7. Verify

| Check | URL / command |
|-------|---------------|
| Gateway health | http://127.0.0.1:3100/health |
| Frontend | http://127.0.0.1:5173 |
| Public dashboard | http://127.0.0.1:5173/public |
| Docker services | `docker compose ps` |

## 8. Optional: Fabric network

Fabric runs outside Docker Compose on the WSL host. See [Fabric deployment](../infrastructure/fabric-deployment.md).

```powershell
pnpm fabric:start    # Start network + channel
pnpm fabric:deploy   # Deploy complaint-anchor chaincode
pnpm fabric:seed     # Seed test complaints on ledger
```

## Automated bootstrap

For a guided first-time setup:

```powershell
pnpm setup
```

This runs `ops/dev/setup.ps1`, which checks prerequisites, copies env templates, and verifies tooling.

## Next steps

- [Local development](./local-development.md) — day-to-day workflow
- [Architecture overview](../architecture/overview.md) — how the pieces fit together
- [Deployment](../operations/deployment.md) — Kind, k8s, and cloud targets
