# Contributing to RoadWatch

RoadWatch is a multi-service monorepo with frontend, backend, Fabric chaincode, and documentation. Keep changes small, targeted, and consistent with the existing service boundaries.

## Before you start

1. Read [README.md](./README.md) and [docs/INDEX.md](./docs/INDEX.md) to understand the current architecture.
2. Check the relevant service document in [docs/services/](./docs/services/) before editing code.
3. Prefer minimal changes that fit the current patterns instead of broad refactors.

## Development workflow

1. Install dependencies with `pnpm install`.
2. Start the stack with the project scripts or `docker compose` profiles documented in the README.
3. Make the smallest change that addresses the issue.
4. Run the narrowest useful validation for the touched area.

## Code style

- Use TypeScript and keep public APIs stable unless a change explicitly requires a break.
- Follow the local module conventions in each package or app.
- Keep documentation in Markdown with clear headings and direct links.

## Testing expectations

- Add or update tests when behavior changes.
- Prefer focused tests near the changed code.
- If a full test suite is too expensive, run the smallest meaningful check and note any remaining risk in the change summary.

## Pull request checklist

- Explain what changed and why.
- Link the files or docs that were updated.
- Mention any follow-up work that was intentionally left out.
- Call out validation that was actually run.

## Repository notes

- `README.md` is the main project entry point.
- `docs/INDEX.md` is the canonical documentation map.
- `docs/current-state.md` is the fastest way to understand the current repo snapshot.
- Service-specific behavior belongs in the matching document under `docs/services/`.
