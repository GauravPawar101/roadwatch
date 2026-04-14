# RoadWatch Testing Strategy

This document defines the **test pyramid**, coverage targets, and the concrete tooling/entrypoints in this repo for:
- unit / integration / e2e testing
- provider mocks (offline-first)
- offline simulation (2G/EDGE) in CI
- Fabric chaincode integration tests
- agent/prompt regression testing
- load + chaos testing

## Test pyramid (definition)

### Unit tests (fast, deterministic)
**Goal:** validate pure logic with no network, no DB, no filesystem.
- Examples: core engines (`ComplaintEngine`, `SyncEngine`, `NetworkDegradationManager`), utilities, parsers.
- Characteristics: < 100ms per test; runs on every PR.

### Integration tests (real boundaries)
**Goal:** validate correctness across *one* boundary (DB, HTTP server, message bus), but not the full system.
- Examples: `gateway-api` route handlers with a real Postgres, notification dispatcher with a fake provider.
- Characteristics: seconds-to-minutes; runs on PR (can be split into “smoke” vs “full”).

### End-to-end (E2E) tests (system workflows)
**Goal:** validate critical user journeys across multiple components.
- Example scenario: **citizen files complaint → authority resolves → chain verified**.
- Characteristics: slower; runs on merges/nightly.

## Core engine test coverage targets

Targets are for **`packages/core/src/engines/*`** (logic-heavy, offline-safe code):
- **Unit coverage target:** 80% lines / 80% branches (aspirational target)
- **Minimum gate (start now):** 60% lines / 50% branches

Rationale:
- Engines are the “brain” of offline behavior and should remain stable.
- Provider integrations (SMS, FCM, WhatsApp, Fabric) are covered via integration tests + contract tests.

## Provider mock library

We keep reusable mocks in `@roadwatch/test-utils`:
- `MockLocalStore` implements `ILocalStore`
- `MockFabricStore` implements `IBlockchainStore` (in-memory ledger simulation)
- (Optional additions later) `MockOutboxQueue`, `MockVectorIndex`

Design rules:
- Deterministic, pure in-memory
- Supports assertions (e.g., “anchored hashes list contains X”)
- Never uses timers unless explicitly controlled

## Offline simulation testing (2G/EDGE in CI)

There are two layers:

### 1) Unit-level simulation (preferred)
Use `NetworkDegradationManager` to assert behavior under:
- `OFFLINE`
- `EDGE_2G`
- `WIFI_4G`

These tests are fast and stable.

### 2) Network-level simulation (when you need it)
For integration/e2e tests, simulate real network degradation using **Toxiproxy** in Docker:
- Add latency, bandwidth limits, intermittent timeouts
- Route Postgres/HTTP through the proxy

CI approach:
- Start Postgres + toxiproxy via `docker compose -f tests/network/docker-compose.yml up -d`
- Configure the app under test to connect via the proxy endpoint

This gives “2G-ish behavior” without OS-specific `tc netem`.

## Fabric integration tests (local network)

We provide a **harness** to run chaincode against a local Fabric network:
- Start network (docker-based)
- Deploy chaincode from `chaincode/`
- Run gateway client tests (invoke + query)

Entry points:
- `pnpm test:fabric` runs the vitest suite in `tests/fabric/` (expects env vars)
- `tools/fabric-test/` contains helper scripts/docs for starting a local network

## Agent/prompt testing (regression testing prompt outputs)

Prompt regression is treated like **contract testing**:
- Snapshot the prompt text for a fixed fixture input
- Assert critical invariants:
  - prompt contains required sections
  - response contract is stable (e.g. `Respond in JSON: { ... }` keys)

Why not test “exact model output”? Because LLM sampling and provider changes make exact text brittle.
Instead:
- keep **golden fixtures** (prompt strings)
- validate **schema adherence** on representative JSON outputs
- optionally run evaluation jobs (nightly) against a pinned model for drift monitoring

Entrypoint:
- `pnpm test:prompts` (runs `tools/prompt-tests/run.ts`)

## E2E scenarios (must-haves)

Minimum E2E workflows to keep stable:
1) Citizen files complaint (with media)
2) Authority changes status + SLA warning
3) Authority resolves complaint
4) Chain verification passes (hash anchored and verifiable)
5) Notifications are recorded + inbox shows expected items

These can be split:
- “API E2E” (HTTP + DB)
- “Fabric E2E” (chaincode + gateway client)

## Load testing (10,000 concurrent complaints)

We use **k6** scripts to simulate load:
- High-write path: create complaints
- Read-heavy path: list/search/notifications

Notes:
- 10k concurrent is usually **distributed** load; a single runner may not generate it.
- Start with step-load (1k → 2k → 5k) and observe latency + DB saturation.

Entrypoint:
- `pnpm loadtest` (runs a Dockerized k6 runner)

## Chaos testing (Fabric node down mid-transaction)

Chaos goals:
- Ensure the client retries safely
- Ensure idempotency (no duplicate complaint IDs)
- Ensure partial commits are detected and surfaced

Technique:
- Start local Fabric
- Run a loop of submits
- Kill a peer/orderer container mid-run
- Verify:
  - client receives a deterministic error
  - retry works once the node is back
  - ledger state remains consistent

Entrypoint:
- `pnpm chaostest` (scaffold script)
