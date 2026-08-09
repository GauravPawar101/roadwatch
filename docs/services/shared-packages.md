# Shared Packages

Workspace libraries shared across apps and services.

## Core domain

| Package | Path | Purpose |
|---------|------|---------|
| `@roadwatch/core` | `packages/core/` | Domain models, engines (Complaint, Sync, Routing, Budget), escalation, Fabric ledger service, Postgres pool, karma, privacy, verification |
| `@roadwatch/adapters` | `packages/adapters/` | Country adapters — India: NHAI/PWD hierarchies, RTI framework, road types |
| `@roadwatch/config` | `packages/config/` | DI container, env configs (`india-production`) |

## Infrastructure clients

| Package | Path | Purpose |
|---------|------|---------|
| `@roadwatch/kafka` | `packages/kafka/` | KafkaJS client, dual-cluster config, topic definitions, event types |
| `@roadwatch/redis` | `packages/redis/` | ioredis client, idempotency helpers, backpressure |
| `@roadwatch/sidecar-auth` | `packages/sidecar-auth/` | Service-to-gateway JWT middleware and registration |

## Providers and storage

| Package | Path | Purpose |
|---------|------|---------|
| `@roadwatch/providers` | `packages/providers/` | JWT auth, backend API client, gov data, Kafka outbox relay |
| `@roadwatch/storage-sqlite` | `packages/providers/storage-sqlite/` | Mobile encrypted SQLite key store |
| `@roadwatch/authority-node` | `packages/authority-node/` | Fabric custodial signer utilities |

## Mobile features

| Package | Path | Purpose |
|---------|------|---------|
| `@roadwatch/features` | `packages/features/` | Feature barrel export |
| `@roadwatch/feature-complaint` | `packages/features/feature-complaint/` | Mobile complaint filing UI |
| `@roadwatch/feature-map` | `packages/features/feature-map/` | Mobile map UI |
| `@roadwatch/feature-agent` | `packages/features/feature-agent/` | Mobile agent chat UI |

## Testing

| Package | Path | Purpose |
|---------|------|---------|
| `@roadwatch/test-utils` | `packages/test-utils/` | Shared test helpers |

## Migrations

Database migrations live in `packages/core/migrations/*.sql` and are applied at runtime via gateway `initDb()`.

## Build

```powershell
pnpm build:packages     # Build all packages
pnpm typecheck:packages # Typecheck all packages
```

## Dependency strategy

- Apps depend on packages, never the reverse.
- `packages/core` has no app dependencies.
- Feature packages depend on `core` and `config`.
- Infrastructure packages (`kafka`, `redis`) are leaf dependencies.
