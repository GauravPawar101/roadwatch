# Contributing to RoadWatch

RoadWatch is a multi-service monorepo. Keep changes small, targeted, and consistent with existing service boundaries.

## Before you start

1. Read [README.md](./README.md) and [docs/README.md](./docs/README.md).
2. Check the relevant service doc in [docs/services/](./docs/services/) before editing code.
3. Prefer minimal changes that fit current patterns over broad refactors.

## Development workflow

1. Install dependencies: `pnpm install`
2. Start infrastructure: `docker compose up -d`
3. Seed demo data: `pnpm seed:demo`
4. Start dev servers: `pnpm dev` or `pnpm start:all`
5. Make the smallest change that addresses the issue.
6. Run the narrowest useful validation for the touched area.

## Code style

- Use TypeScript; keep public APIs stable unless a change explicitly requires a break.
- Follow local module conventions in each package or app.
- Match existing naming, types, and import style.
- Reuse and extend existing functions rather than reimplementing.

## Testing

- Add or update tests when behavior changes.
- Prefer focused tests near the changed code.
- Run the narrowest test suite: `pnpm test:unit`, `pnpm test:api`, etc.
- See [docs/development/testing.md](./docs/development/testing.md).

## Documentation

- Update docs in `docs/` when behavior, ports, or workflows change.
- [docs/README.md](./docs/README.md) is the documentation index.
- Service-specific behavior belongs in the matching `docs/services/` file.

## Pull request checklist

- Explain what changed and why.
- Link files or docs that were updated.
- Mention follow-up work intentionally left out.
- Call out validation that was actually run.

## Repository notes

- `README.md` — project entry point.
- `docs/README.md` — canonical documentation map.
- `docs/reference/test-credentials.md` — demo login credentials.
- `.env.example` files — environment templates (never commit real `.env` files).
