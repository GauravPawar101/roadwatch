# Seeding and Onboarding

Populate RoadWatch with demo data and onboard new environments.

## Demo data seed

```powershell
pnpm seed:demo
```

Runs `apps/gateway-api/scripts/seed-demo-data.ts`, which creates:

- Users for all roles (CE, EE, CITIZEN, CONTRACTOR)
- States, districts, and road segments
- Sample complaints in various statuses
- Authority profiles with jurisdiction mappings
- Contractor profiles with assigned roads
- Kafka outbox events for Fabric-bound complaints

### Login credentials

All seeded accounts use password: **RoadWatch@123**

See [Test credentials](../reference/test-credentials.md) for the full account list.

## Backend seed

```powershell
pnpm seed:backend
```

Runs `scripts/seed-backend.ts` for backend-specific data.

## Deterministic test IDs

File: `scripts/test-ids.env` (gitignored — copy from team or generate)

```powershell
tsx scripts/test-ids.ts
```

Provides consistent road IDs, complaint IDs, and region IDs for testing.

## Fabric ledger seed

Requires a running Fabric network with deployed chaincode:

```powershell
pnpm fabric:seed
```

Seeds test complaints on the Hyperledger Fabric ledger.

## First-time environment setup

### 1. Bootstrap

```powershell
pnpm setup
```

Runs `ops/dev/setup.ps1`:

- Checks prerequisites (Node, pnpm, Docker)
- Copies `.env.example` files
- Creates required directories
- Verifies Fabric tooling (optional)

### 2. Verify bootstrap

```powershell
pwsh -File ops/dev/verify-bootstrap.ps1
```

### 3. Start and seed

```powershell
docker compose up -d
pwsh -File scripts/init-messaging.ps1
pnpm seed:demo
pnpm start:all
```

### 4. Verify access

| Check | URL |
|-------|-----|
| Gateway health | http://127.0.0.1:3100/health |
| Frontend | http://127.0.0.1:5173 |
| Login as CE | super.admin.01 / RoadWatch@123 |
| Public dashboard | http://127.0.0.1:5173/public |

## Onboarding new team members

1. Clone repo and run `pnpm setup`
2. Read [Setup](../getting-started/setup.md) and [Architecture overview](../architecture/overview.md)
3. Use [Test credentials](../reference/test-credentials.md) to log in as different roles
4. File a test complaint as citizen, triage as authority
5. Optional: start Fabric and verify anchoring pipeline

## Related docs

- [Test credentials](../reference/test-credentials.md)
- [Local development](../getting-started/local-development.md)
- [Database](../infrastructure/database.md)
