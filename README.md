# RoadWatch

Blockchain-enabled citizen complaint management for road infrastructure — real-time analytics, authority workflows, and immutable audit trails.

## Quick start

```powershell
pnpm install
docker compose up -d
pnpm seed:demo
pnpm start:all
```

| Service | URL |
|---------|-----|
| Frontend | http://127.0.0.1:5173 |
| Gateway API | http://127.0.0.1:3100 |
| Public dashboard | http://127.0.0.1:5173/public |

Demo login: `super.admin.01` / `RoadWatch@123` — see [test credentials](./docs/reference/test-credentials.md).

## Documentation

Full documentation is in [`docs/`](./docs/README.md):

| Topic | Link |
|-------|------|
| Setup guide | [docs/getting-started/setup.md](./docs/getting-started/setup.md) |
| Architecture | [docs/architecture/overview.md](./docs/architecture/overview.md) |
| Workflows | [docs/workflows/](./docs/workflows/README.md) |
| Services | [docs/services/](./docs/services/README.md) |
| Deployment | [docs/operations/deployment.md](./docs/operations/deployment.md) |
| All commands | [docs/development/scripts-and-commands.md](./docs/development/scripts-and-commands.md) |

## Architecture

```
Citizen/Mobile → Gateway API → Postgres
                    │              │
                    ├─ kafka-hlf ──┼─► Fabric Anchor → Hyperledger Fabric
                    └─ kafka-events ─► Webhook Handler → Notifications
```

- **Gateway API** — REST API, auth, complaints, RTI, analytics, AI agent
- **Frontend** — React web dashboard (citizen, authority, contractor, public)
- **Mobile** — React Native citizen app
- **Fabric** — Merkle-root anchoring on `roadwatch-india` channel
- **Dual Kafka** — HLF backpressure (9094) + operational events (9095)

## Key commands

```powershell
pnpm dev                  # All Node apps
pnpm dev:api              # Gateway only
pnpm test                 # Run tests
pnpm fabric:start         # Start Fabric network (WSL)
pnpm deploy:kind          # Deploy to local Kubernetes
```

## Monorepo structure

```
apps/          gateway-api, mobile-host
backend-api/   Internal data API
frontend/      React web app
services/      scheduler, webhook-handler, fabric-anchor-consumer
packages/      core, kafka, redis, adapters, features
fabric/        Hyperledger Fabric network and chaincodes
k8s/           Kubernetes manifests (layer-based)
ops/           Dev bootstrap and deploy scripts
docs/          Documentation
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
