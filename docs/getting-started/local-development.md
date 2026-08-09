# Local Development

Day-to-day workflow for working on RoadWatch locally.

## Start the stack

```powershell
# Infrastructure (Postgres, Kafka, Redis, workers)
docker compose up -d

# All Node apps (gateway, backend, frontend, services)
pnpm dev

# Or Windows all-in-one
pnpm start:all
```

## Run individual services

| Command | Service | Port |
|---------|---------|------|
| `pnpm dev:api` | Gateway API | 3100 |
| `pnpm dev:backend` | Backend API | 4001 |
| `pnpm dev:frontend` | Frontend (Vite) | 5173 |
| `pnpm dev:scheduler` | Scheduler | — |
| `pnpm dev:webhook` | Webhook handler | — |
| `pnpm dev:fabric-consumer` | Fabric anchor consumer | — |
| `pnpm mobile` | Mobile Metro bundler | — |

## Common tasks

### Reseed demo data

```powershell
pnpm seed:demo
```

### Query Fabric ledger

```powershell
pnpm fabric:query:history    # Complaint history
pnpm fabric:query:by-road    # Complaints by road ID
```

### Typecheck and lint

```powershell
pnpm typecheck
pnpm lint
```

### Run tests

```powershell
pnpm test              # All packages via Turbo
pnpm test:unit         # @roadwatch/core only
pnpm test:api          # Gateway API
pnpm test:fabric       # Fabric integration
```

## Hot reload

- **Gateway / backend / services**: `tsx watch` or equivalent — changes reload automatically.
- **Frontend**: Vite HMR on save.
- **Mobile**: Metro fast refresh; shake device for dev menu.
- **Docker workers**: Rebuild or restart container after code changes unless you run the worker via `pnpm dev:*` instead.

## Database access

Connect directly to Postgres (bypassing PgBouncer):

```
postgresql://postgres:postgres@127.0.0.1:15433/roadwatch
```

Applications should use PgBouncer (`16432`) for connection pooling.

Schema is initialized by `docker/postgres/init.sql` on first container start. Runtime migrations run via `initDb()` in the gateway on startup.

## Stopping safely

Prefer non-destructive stops to preserve data:

```powershell
docker compose stop          # Stop containers, keep volumes
.\ops\dev\stop-all.sh        # Bash stop script
.\ops\teardown\stop-all.ps1  # PowerShell teardown
```

**Avoid** `docker compose down --volumes` unless you intend to wipe all local data (Postgres, Kafka offsets, Redis cache).

## Fabric development

Fabric runs in WSL, not inside the main Docker Compose stack:

```powershell
pnpm fabric:start    # Start network
pnpm fabric:deploy   # Deploy chaincode
pnpm fabric:reset    # Full teardown + regenerate artifacts
```

## IDE tips

- Open the repo root in your editor — TypeScript project references resolve across workspaces.
- Gateway API is the primary API surface; start here when tracing request flows.
- Shared domain logic lives in `packages/core`.
- Event types and Kafka topics are defined in `packages/kafka`.

## See also

- [Scripts and commands](../development/scripts-and-commands.md)
- [Testing](../development/testing.md)
- [Troubleshooting](../operations/troubleshooting.md)
