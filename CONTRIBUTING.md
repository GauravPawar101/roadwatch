# Contributing to RoadWatch

Thanks for helping improve RoadWatch. This monorepo spans web, mobile, APIs, workers, and Hyperledger Fabric — so small, targeted changes that respect existing service boundaries land fastest.

---

## Before you start

1. Skim [README.md](./README.md) and the [docs index](./docs/README.md).
2. Open the matching guide under [docs/services/](./docs/services/) for the area you will touch.
3. Prefer extending current patterns over broad refactors.
4. Never commit real secrets, keys, or production `.env` files.

---

## Development setup

| Step | Command |
|------|---------|
| Install | `pnpm install` |
| Infra | `docker compose up -d` |
| Seed | `pnpm seed:demo` |
| Run | `pnpm start:all` or `pnpm dev` |

**Requirements:** Node.js 20+, pnpm 8+, Docker Desktop. Optional Fabric / mobile / kind tools are listed in [prerequisites](./docs/getting-started/prerequisites.md).

Demo logins: [test credentials](./docs/reference/test-credentials.md).

---

## How we work

### Scope

- One concern per PR when possible (feature, fix, or docs — not all three unless tightly coupled).
- Match naming, types, and import style in the package you edit.
- Keep public APIs stable unless the change intentionally breaks them — call that out in the PR.

### TypeScript & structure

- Prefer TypeScript for new code.
- Reuse shared packages (`packages/core`, `kafka`, `redis`, `adapters`) instead of duplicating logic.
- Put India-specific legal / authority rules in `packages/adapters`, not hard-coded in the gateway.
- Postgres remains the source of truth; Fabric is for anchors and audit metadata only.

### Coding standards

- **Imports**: Use relative imports for same-package code, workspace protocol (`@roadwatch/*`) for cross-package.
- **Async**: All route handlers must be async-safe (wrapped by `makeAsyncSafe` in `apps/gateway-api/src/app.ts`).
- **SQL**: Use tagged template literals via `sql`/`sqlFragment` from `@roadwatch/gateway-api/src/postgres.ts` for type-safe queries.
- **Errors**: Throw typed errors with `statusCode` and `retryAfterSeconds` for retryable failures (e.g., DB pool exhaustion → 503).
- **Secrets**: Never log secrets. Use `x-service-token` header for inter-service auth.
- **Observability**: Every service logs startup endpoint resolution (see `reportInfrastructure` in `@roadwatch/core`).

### Testing

| Area | Suggested command |
|------|-------------------|
| Unit (core) | `pnpm test:unit` |
| Gateway | `pnpm test:api` |
| Backend | `pnpm test:backend` |
| Full suite | `pnpm test` |

- Add or update tests when behavior changes.
- Prefer focused tests next to the changed code.
- Details: [docs/development/testing.md](./docs/development/testing.md).

### Documentation

Update `docs/` when you change behavior, ports, env vars, or workflows. Service-specific notes belong in the matching `docs/services/` page. Keep [docs/README.md](./docs/README.md) as the map.

---

## Pull requests

### Checklist

- [ ] Clear title and short summary of **what** and **why**
- [ ] Linked issue or context (if any)
- [ ] Docs updated when user-facing or operational behavior changed
- [ ] Narrowest useful tests / checks actually run (list them)
- [ ] No secrets or large binaries accidentally included
- [ ] Follow-ups called out if intentionally deferred

### Suggested PR body

```markdown
## Summary
- …

## Test plan
- [ ] …
```

### Review tips

- Call out risky areas (auth, outbox/Kafka, Fabric, migrations).
- Screenshots or curl examples help for UI / API changes.
- Keep Fabric / WSL steps optional in the test plan unless the PR depends on them.

---

## Project structure

```
roadwatch/
├── apps/
│   ├── gateway-api/          # Main REST API (Express + TypeScript)
│   ├── mobile-host/          # React Native citizen app (Expo)
│   └── ...                   # Other apps
├── backend-api/              # Internal analytics / data APIs
├── frontend/                 # Web dashboards (React + Vite)
├── fabric/
│   └── chaincode/            # Hyperledger Fabric chaincode (JS/Go)
├── k8s/                      # Kubernetes manifests (Kustomize)
├── ops/                      # Operational scripts (deploy, bootstrap)
├── packages/
│   ├── core/                 # Shared utilities, engines, config
│   ├── kafka/                # Kafka client, topics, schemas
│   ├── redis/                # Redis client, admission, cache
│   ├── adapters/             # Country-specific adapters (India, Kenya)
│   ├── providers/            # Storage, auth, AI, map providers
│   ├── features/             # Feature modules (complaint, map, agent)
│   ├── authority-node/       # Authority node services
│   └── ...                   # Other shared packages
├── services/
│   ├── scheduler/            # Cron jobs (SLA, karma, reports)
│   ├── webhook-handler/      # Kafka consumer for webhooks
│   ├── fabric-anchor-consumer/ # Fabric event consumer
│   ├── media-ingest/         # Image/video processing
│   └── ...                   # Other workers
├── docs/                     # All documentation
├── tools/                    # Load testing, profiling, verification
└── scripts/                  # One-off utilities
```

---

## Key workflows

### Complaint lifecycle
See [docs/workflows/complaint-lifecycle.md](./docs/workflows/complaint-lifecycle.md)

1. **Citizen creates** → `POST /citizen/complaints` → proximity dedupe → `kafka_event_outbox` → `complaint-submitted`
2. **Authority merges/creates** → `POST /authority/complaints` → SLA tracking → karma
3. **Status changes** → `POST /authority/complaints/:id/status` → `complaint-status-changed` → Fabric anchor
4. **Repair verification** → AI model → `complaint_repair_verifications` gate
5. **Resolve** → requires passing verification → `RESOLVED` → org karma reward

### Event pipeline
See [docs/architecture/event-pipeline.md](./docs/architecture/event-pipeline.md)

- Gateway writes to `kafka_event_outbox` (transactional)
- Relay publishes to Kafka (dual-cluster: events + HLF)
- Consumers: webhook-handler, fabric-anchor-consumer
- DLQ for failed deliveries

### SLA & Escalation
- Road-type base: NH/SH/MDR = 7 days, URBAN/RURAL = 2 days
- Severity multiplier: CRITICAL 0.5×, HIGH 0.75×, MODERATE 1×, LOW 1.5×
- Scheduler detects breaches → escalates → publishes `complaint-status-changed`
- Karma penalties: contractor, engineer, org (scaled by road-km)

---

## Environment variables

See [.env.example](./.env.example) and [docs/getting-started/environment-variables.md](./docs/getting-started/environment-variables.md).

Key variables:
- `DATABASE_URL` / `DATABASE_CLOUD_URL` — Postgres (prefers PgBouncer)
- `REDIS_URL` / `REDIS_CLOUD_URL` — Redis (Upstash TLS)
- `KAFKA_EVENTS_BROKERS` / `KAFKA_HLF_BROKERS` — Dual Kafka clusters
- `PGBOUNCER_HOST` / `PGBOUNCER_PORT` — Connection pooling
- `JWT_SECRET` — Auth token signing

---

## Local development commands

```bash
# Start all services
pnpm start:all

# Run only gateway API
pnpm dev:api

# Run only workers
pnpm dev:services

# Type-check everything
pnpm typecheck

# Run tests
pnpm test

# Run load probe
pnpm load:probe

# Apply schema to DB
pnpm ops:apply-schema
```

---

## Common pitfalls

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED 127.0.0.1:16432` | Check `TOP_POSTGRES_HOST_PORT=16432` in `.env`, ensure PgBouncer is healthy |
| Test fails with `DATABASE_URL` ignored | Turbo strict mode — `pnpm exec turbo run test --env-mode=loose` or add to `globalEnv` in `turbo.json` |
| Cache stampede on writes | Read cache now per-district/zone — pass `{district, zone}` to `bumpComplaintReadCache` |
| Karma resets hourly | Disabled — incremental system handles karma; don't re-enable hourly recalc |
| `authority_org` migration needed | Run `pnpm ops:apply-schema` after pulling new `init.sql` |
| Gateway single-process | Set `CLUSTER_WORKERS` or rely on default `availableParallelism()` |

---

## Release & deployment

- K8s: `pnpm k8s:up` (kind) or `pnpm deploy:k8s` (cloud)
- Docker Compose: `pnpm infra:up`
- Fabric: `pnpm fabric:deploy` (requires running network)
- Schema: `pnpm ops:apply-schema` (targets cloud DB by default — confirm!)

---

## Questions & issues

- Architecture: [docs/architecture/overview.md](./docs/architecture/overview.md)
- Complaint flow: [docs/workflows/complaint-lifecycle.md](./docs/workflows/complaint-lifecycle.md)
- Commands: [docs/development/scripts-and-commands.md](./docs/development/scripts-and-commands.md)
- Troubleshooting: [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)

If something in the docs is wrong or missing, a docs-only PR is always welcome.