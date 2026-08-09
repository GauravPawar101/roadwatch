# Contributing to RoadWatch

Thanks for helping improve RoadWatch. This monorepo spans web, mobile, APIs, workers, and Hyperledger Fabric — so small, targeted changes that respect existing service boundaries land fastest.

---

## Before you start

1. Skim [README.md](./README.md) and the [docs index](./docs/README.md).
2. Open the matching guide under [docs/services/](./docs/services/) for the area you will touch.
3. Prefer extending current patterns over broad refactors.
4. Never commit real secrets, keys, or production `.env` files ([SECRETS.md](./SECRETS.md)).

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

## Where things live

| Path | Own it when… |
|------|----------------|
| `apps/gateway-api` | REST, auth, complaints, outbox, AI agent |
| `backend-api` | Internal data / analytics APIs |
| `frontend` | Web dashboards and portals |
| `apps/mobile-host` | React Native citizen shell |
| `services/*` | Workers (scheduler, webhooks, Fabric anchor, media) |
| `packages/*` | Shared libraries and adapters |
| `fabric/` | Network scripts and chaincode |
| `k8s/` / `ops/` | Deploy and bootstrap |
| `docs/` | Canonical documentation |

---

## Questions & issues

- Architecture: [docs/architecture/overview.md](./docs/architecture/overview.md)
- Complaint flow: [docs/workflows/complaint-lifecycle.md](./docs/workflows/complaint-lifecycle.md)
- Commands: [docs/development/scripts-and-commands.md](./docs/development/scripts-and-commands.md)
- Troubleshooting: [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)

If something in the docs is wrong or missing, a docs-only PR is always welcome.
