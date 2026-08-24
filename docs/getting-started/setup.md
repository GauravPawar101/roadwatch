# Setup

Step-by-step guide to get RoadWatch running from a clean checkout.

`pnpm setup`, `pnpm start:all`, and `pnpm fabric:*` auto-pick **PowerShell on Windows** or **bash on Linux/macOS** via `ops/dev/run.mjs`.

## 1. Clone and install

```bash
git clone <repo-url> roadwatch
cd roadwatch
pnpm install
```

pnpm workspaces install all apps, services, and packages from the root.

## 2. Copy environment files

**Linux / macOS**

```bash
cp -n .env.example .env
cp -n apps/gateway-api/.env.example apps/gateway-api/.env
cp -n backend-api/.env.example backend-api/.env 2>/dev/null || true
cp -n services/fabric-anchor-consumer/.env.example services/fabric-anchor-consumer/.env
cp -n apps/mobile-host/.env.example apps/mobile-host/.env
```

Or run the bootstrapper (copies all examples + checks tools):

```bash
pnpm setup
# same as: ./ops/dev/setup.sh
```

**Windows (PowerShell)**

```powershell
Copy-Item .env.example .env
Copy-Item apps/gateway-api/.env.example apps/gateway-api/.env
Copy-Item services/fabric-anchor-consumer/.env.example services/fabric-anchor-consumer/.env
Copy-Item apps/mobile-host/.env.example apps/mobile-host/.env
# or: pnpm setup
```

Edit `apps/gateway-api/.env` at minimum. Set `DATABASE_URL`, `JWT_SECRET`, and Kafka/Redis URLs. See [Environment variables](./environment-variables.md).

## 3. Start infrastructure

```bash
docker compose up -d
# or: pnpm infra:up
```

This starts Postgres, PgBouncer, dual Kafka clusters, Redis, and background workers (scheduler, webhook-handler, fabric-anchor-consumer).

Infra only (skip building worker images):

```bash
docker compose up -d postgres pgbouncer kafka-hlf kafka-events redis
```

Optional media ingest:

```bash
docker compose --profile media up -d
```

## 4. Initialize Kafka topics (first run)

```bash
pnpm init:messaging
# Linux: ./scripts/init-messaging.sh
# Windows: pwsh -File scripts/init-messaging.ps1
```

## 5. Seed demo data

```bash
pnpm seed:demo
```

Login credentials: [Test credentials](../reference/test-credentials.md).

## 6. Start application servers

**Option A — one command**

```bash
pnpm start:all
# Linux: ./ops/dev/start-all.sh [--skip-fabric] [--skip-seed]
# Windows: .\ops\dev\start-all.ps1
```

**Option B — Turbo dev**

```bash
pnpm dev
```

**Option C — individual services**

```bash
pnpm dev:api        # Gateway API on :3100
pnpm dev:backend    # Backend API on :4001
pnpm dev:frontend   # Frontend on :5173
```

Stop background services started by `start:all`:

```bash
pnpm stop:all
```

## 7. Verify

| Check | URL / command |
|-------|---------------|
| Gateway health | http://127.0.0.1:3100/health |
| Frontend | http://127.0.0.1:5173 |
| Public dashboard | http://127.0.0.1:5173/public |
| Docker services | `docker compose ps` |

## 8. Optional: Fabric network

**Linux:** Fabric runs on the host (same Docker daemon).

```bash
pnpm fabric:start    # Start network + channel
pnpm fabric:deploy   # Deploy complaint-anchor chaincode
pnpm fabric:seed     # Seed test complaints on ledger
```

**Windows:** Fabric runs inside WSL. See [Fabric deployment](../infrastructure/fabric-deployment.md).

## Automated bootstrap

```bash
pnpm setup
pnpm verify:bootstrap
```

## Next steps

- [Local development](./local-development.md) — day-to-day workflow
- [Architecture overview](../architecture/overview.md) — how the pieces fit together
- [Deployment](../operations/deployment.md) — Kind, k8s, and cloud targets
