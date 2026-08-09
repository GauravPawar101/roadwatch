# Scripts and Commands

Reference for all development, build, test, and deployment commands.

## Setup

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm setup` | Guided first-time bootstrap (`ops/dev/setup.ps1`) |
| `pnpm setup:skip-install` | Bootstrap without `pnpm install` |

## Development

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps via Turbo (parallel) |
| `pnpm start:all` | Windows all-in-one start (`ops/dev/start-all.ps1`) |
| `pnpm start:all:k8s` | Start with Kubernetes target |
| `pnpm dev:api` | Gateway API only |
| `pnpm dev:backend` | Backend API only |
| `pnpm dev:frontend` | Frontend only |
| `pnpm dev:services` | Scheduler + webhook + fabric-consumer |
| `pnpm dev:scheduler` | Scheduler only |
| `pnpm dev:webhook` | Webhook handler only |
| `pnpm dev:fabric-consumer` | Fabric anchor consumer only |
| `pnpm dev:sidecar` | Sidecar auth package dev |

## Mobile

| Command | Description |
|---------|-------------|
| `pnpm mobile` | Start Metro bundler |
| `pnpm mobile:android` | Run on Android |
| `pnpm mobile:ios` | Run on iOS |
| `pnpm mobile:pods` | Install CocoaPods |
| `pnpm mobile:clean` | Clean build artifacts |

## Build

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages and apps |
| `pnpm build:api` | Gateway API |
| `pnpm build:backend` | Backend API |
| `pnpm build:frontend` | Frontend |
| `pnpm build:packages` | All shared packages |
| `pnpm build:chaincode` | TypeScript chaincode stub |

## Test

| Command | Description |
|---------|-------------|
| `pnpm test` | All tests via Turbo |
| `pnpm test:unit` | `@roadwatch/core` unit tests |
| `pnpm test:api` | Gateway API tests |
| `pnpm test:backend` | Backend API tests |
| `pnpm test:fabric` | Fabric integration tests |
| `pnpm test:prompts` | LLM prompt regression |
| `pnpm test:coverage` | Core package coverage |

## Typecheck and lint

| Command | Description |
|---------|-------------|
| `pnpm typecheck` | All packages |
| `pnpm lint` | All packages |
| `pnpm typecheck:mobile` | Mobile only |
| `pnpm lint:mobile` | Mobile only |

## Infrastructure

| Command | Description |
|---------|-------------|
| `pnpm infra:up` | `docker compose up -d` |
| `pnpm infra:down` | `docker compose down` |
| `pnpm infra:reset` | `docker compose down --volumes` |
| `pnpm infra:logs` | `docker compose logs -f` |
| `pnpm infra:ps` | `docker compose ps` |

## Fabric

| Command | Description |
|---------|-------------|
| `pnpm fabric:start` | Start Fabric network (WSL) |
| `pnpm fabric:deploy` | Deploy chaincode |
| `pnpm fabric:reset` | Full Fabric reset |
| `pnpm fabric:seed` | Seed test complaints on ledger |
| `pnpm fabric:query:history` | Query complaint history |
| `pnpm fabric:query:by-road` | Query complaints by road |

## Seed

| Command | Description |
|---------|-------------|
| `pnpm seed:demo` | Seed demo data into Postgres |
| `pnpm seed:backend` | Backend-specific seed |

## Deploy

| Command | Description |
|---------|-------------|
| `pnpm deploy` | Deploy router (`ops/deploy/deploy.ps1`) |
| `pnpm deploy:local` | Local Docker deploy |
| `pnpm deploy:local:apps` | Local apps only, skip Fabric |
| `pnpm deploy:kind` | Kind cluster deploy |
| `pnpm deploy:k8s` | Existing k8s cluster |
| `pnpm deploy:aws` | AWS/EKS deploy |

## Kubernetes

| Command | Description |
|---------|-------------|
| `pnpm k8s:up` | Create Kind cluster + deploy |
| `pnpm k8s:reset` | Reset and redeploy |
| `pnpm k8s:down` | Delete Kind cluster |
| `pnpm k8s:logs` | Tail gateway logs |
| `pnpm k8s:status` | Pod status |

## Clean

| Command | Description |
|---------|-------------|
| `pnpm clean` | Clean build artifacts |
| `pnpm clean:all` | Clean + remove all node_modules |
| `pnpm clean:build` | Clean build outputs only |

## Utility scripts

| Script | Purpose |
|--------|---------|
| `scripts/init-messaging.ps1` | Create Kafka topics |
| `scripts/fabric-ledger.ts` | Fabric CLI (seed, query) |
| `scripts/seed-backend.ts` | Backend seeding |
| `scripts/test-ids.ts` | Deterministic test IDs |
| `tools/produce-test-events.ts` | Kafka test event producer |
| `tools/prompt-tests/run.ts` | LLM prompt tests |
| `tools/chaos/run.mjs` | Chaos testing |
| `tools/load/run-k6.mjs` | Load testing (k6) |

## Ops scripts

| Script | Purpose |
|--------|---------|
| `ops/dev/setup.ps1` | First-time bootstrap |
| `ops/dev/start-all.ps1` | One-command local start |
| `ops/dev/verify-bootstrap.ps1` | Post-setup verification |
| `ops/deploy/deploy.ps1` | Deploy router |
| `ops/teardown/stop-all.ps1` | Tear down local resources |
