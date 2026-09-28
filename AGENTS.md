# AGENTS.md

Standing instructions for coding agents working in this repository.

## State report — maintain after every significant change

The project's current state is tracked in an external report:

```
~/Desktop/OpenSource/roadwatch/STATE.md
```

**After any significant change, update it.** "Significant" means anything that changes what the
system does, what exists, or what is broken — not formatting, dependency bumps, or refactors with
no behavioural effect.

When updating:

- Update the **date** and the **verified-against commit hash** in the header. The report is a
  point-in-time snapshot; a stale hash makes every finding in it suspect.
- Re-verify the findings you can cheaply re-verify, and **delete or correct any that no longer
  reproduce.** Findings are cited to `file:line`, so they rot silently as code moves. A finding that
  no longer holds is worse than one that was never recorded.
- Keep the "What this report does not establish" section (§8) honest. If something was not
  measured this session, do not present it as measured.
- Prefer measured numbers over estimates, and label estimates as estimates. The previous report's
  convention is that every figure names the configuration that produced it.

Do not commit this file's subject matter into `docs/` — the report lives outside the repository so
it survives re-cloning and stays separate from the code it describes.

## Known landmines

Verified against commit `194da79`. Each is a case where the code and the documentation disagree,
or where a path looks wired up but is not. Re-verify before relying on any of them — see the report
for full citations.

### Fixed in the working tree on 28 Sep 2026 — not yet deployed

These were remediated on disk but are **not** deployed. Do not treat the source as the running
system. See `STATE.md` §6 and §9 for what is still outstanding.

- **The Fabric anchoring path had never completed a transaction.** `UpsertComplaintSubmission`,
  `UpdateComplaintStatus`, `ResolveComplaint` and `GetComplaintHistory` now exist in
  `fabric/chaincode/complaint-anchor/contract.js` with MSP gating, event-level idempotency and
  composite-keyed history, covered by `services/fabric-anchor-consumer/complaint-anchor.test.ts`.
  **The chaincode still has to be reinstalled on a running network**, and the ledger is still
  empty. Note that the undeployed `chaincode/src/contract.ts` is *not* a drop-in replacement: it
  calls `putPrivateData` against a `citizenPIICollection` that this network does not define, which
  would abort every transaction.
- **The scheduler published to `complaint.status.changed`** (dots) while the declared topic is
  `complaint-status-changed`. Both call sites now use `KafkaTopics.complaintStatusChanged` from the
  new `@roadwatch/kafka/topics` subpath export.
- **`complaint_repair_verifications` had no `CREATE TABLE`**, so every resolve failed closed with
  400. It is now in both bootstrap schemas and has been applied to the local and Aiven databases,
  and the resolve gate's own predicate was exercised against a live database (unverified blocks,
  verified allows, FK enforced). The `upload_repair_proof` agent tool no longer bypasses the
  verification gate, and it now publishes the status change the resolve path needs to reach Fabric.
  Note that adding a file to `packages/core/migrations/` would have done nothing — see below.
- **`SubmitMerkleRoot` ignored `status.successful`.** A Fabric transaction that commits with errors
  is a *successful commit* to the SDK — `submit()` resolves, `getStatus().successful` is `false`,
  and nothing throws. The consumer now checks it and runs the submit under the circuit breaker.

### Still open

- **`pnpm ops:apply-schema` targets the cloud database by default.** It resolves the endpoint with
  `resolvePostgresEndpoint`, which prefers `DATABASE_CLOUD_URL` over `DATABASE_URL`, so a routine
  "apply the schema locally" command applies DDL to Aiven. It has no confirmation prompt. Confirm
  the target before running it.
- **`packages/core/migrations/` is dead code.** `runMigrations` has no call sites, so files placed
  there never run. The live path is `pnpm ops:apply-schema`, which applies
  `docker/postgres/init.sql` wholesale. Do not add a migration there expecting it to execute.
- **Editing `init.sql` does not touch an existing database.** Postgres only runs
  `/docker-entrypoint-initdb.d/*.sql` when the data directory is empty, and a pre-existing volume
  silently keeps the old schema (`ops/dev/start-all.sh:139-141`). Use `ops:apply-schema`, or reset
  the volume.
- **Default Postgres port disagrees between code and compose.** compose defaults
  `TOP_POSTGRES_HOST_PORT` to 15433; the services and `.env.example` default to 16432. The mapping is
  a compose variable, so it is not sticky: bringing up *any* service with a plain
  `docker compose up -d <svc>` can recreate the Postgres container back on 15433 and make the suite
  fail with `ECONNREFUSED 127.0.0.1:16432`. Export the variable, or set it in `.env`.
- **`pnpm test` ignores an exported `DATABASE_URL`.** `turbo.json` declares no `env`/`globalEnv`,
  and turbo defaults to strict env mode, so `DATABASE_URL=… pnpm test` still runs the suite against
  the code default of 16432 and fails with `ECONNREFUSED` even when the export is correct. Use
  `pnpm exec turbo run test --env-mode=loose`, or add `DATABASE_URL` to `globalEnv`. Verified 28 Sep
  2026: 19/19 tasks pass with loose, 18/19 with strict.
- **`docker compose up -d` cannot build its own images.** The `packages/redis` image build fails with
  `TS2307: Cannot find module '@roadwatch/core'` because the Dockerfile does not build that workspace
  dependency first. The same build passes on the host, so the error points at the wrong package. Target
  individual services instead.
- **The deployed chaincode is covered, but from the wrong directory.** `complaint_anchor_test.go`
  (33 tests) covers `complaint_anchor.go`, a *different* implementation from the deployed
  `contract.js`. `contract.js` now has `services/fabric-anchor-consumer/complaint-anchor.test.ts`
  (17 tests), but it lives in the consumer package, so nothing keeps it in step with the contract.
- **`authority_org` is one free-text column carrying four incompatible value types** (zone name,
  UUID, Fabric MSP id, literal `'DefaultAuthority'`). Karma is bucketed under a mixture. This blocks
  per-office accountability and report cards until it is migrated.
- **The hourly karma recalculation erases every SLA penalty**, fans out cartesianly across
  `complaints` × `karma_ledger`, and writes an absolute score into the ledger as a delta, which it
  then averages back in on the next run.
- **Severity is discarded in SLA calculation** — `calculateSLA(_severity, …)`. Potholes and
  streetlights get identical windows on the same road class.
- **`POST /citizen/complaints` stores no category and no severity** (its INSERT omits `metadata`),
  which makes the heatmap, category filters, and citizen-path dedupe inert.
- **`POST /complaints` emits no Kafka events** — `routes/complaints.ts` never imports
  `enqueueKafkaEvent`.
- **`extractExifData` (`packages/core/src/verification-service.ts:48`) has zero call sites**, and
  `services/media-ingest/src/` is empty, so the image the web UI uploads goes nowhere.
- **PgBouncer is deployed but bypassed** — `POSTGRES_HOST` points straight at the primary. With
  `max_connections` unset (100) and `PGPOOL_MAX` unset (20), the fleet exhausts Postgres at ~5
  instances.
- **The gateway is single-process.** No cluster mode, so it cannot exceed ~1 core of JS regardless
  of the prod `2000m` CPU limit.
- **Kubernetes manifests are render-only.** Rootless podman cannot obtain cgroups on this host, so
  nothing in `k8s/` has been run end to end. Do not claim otherwise.
- **Every write still invalidates the whole read cache.** `bumpComplaintReadCache` only `INCR`s a
  generation counter embedded in the read key, so one write orphans every cached list, and a read
  issued after a write still misses. **The stampede this caused is fixed in the working tree**
  (`readThroughCachedJson` in `packages/redis/read-cache.ts` collapses concurrent misses into one
  origin fill), but the invalidation itself is not. Measured: hit rate 61–65 % under writes against
  99.88 % read-only, misses down 4.7×, mixed throughput 1,115–1,309 req/s against 534–674 before.
  Per-district or per-zone keys are still the real fix. See `docs/CAPACITY.md` §9.2.
- **`createAndFanoutNotification` no longer needs a second Postgres connection — but do not undo
  that.** It used to run inside the request's transaction while `resolveAudienceUsers` queried the
  module-level `pool`, so each write held two connections and concurrent writes capped near
  `PGPOOL_MAX / 2`, failing with `timeout exceeded when trying to connect` (2,405 occurrences).
  Fixed in the working tree by passing the transaction's client. **Do not move the notification
  back out after commit** — that is what the comment at
  `apps/gateway-api/src/routes/authority.ts:344` is guarding against (a 500 for an
  already-durable complaint, and a double-counted `report_count` on retry). The write cliff and
  all connect timeouts are gone; peak is 498 writes/s at `PGPOOL_MAX=60`. See
  `docs/CAPACITY.md` §9.4.

## Load-testing footguns

These all produced plausible-looking output while measuring nothing, or measuring the wrong
thing. Together they cost three full sweeps and one retracted result.

- **Never report a single run as a result.** Run-to-run spread on this host is **±25 %**: four
  c64 read runs of one build gave 2,730 / 2,520 / 3,650 / 4,131 req/s. A single pair of runs read
  as a clean 2× win for the read-cache change and vanished under three more runs per arm. Repeat
  every arm at least 3× and quote the band.
- **A cached-read benchmark with no concurrent writes measures a system nobody is writing to.**
  The cache stampede that matters only appears when writes bump the generation. Always report
  read-only *and* mixed.
- **A run is only valid if the Postgres container did not change.** `docker compose up -d <any
  service>` can recreate the Postgres container and remap its host port, because
  `TOP_POSTGRES_HOST_PORT` is not sticky. Record the container ID and start time plus a
  `pg_isready` on both sides of the window and discard the run if either differs. An early sweep
  lost the port mid-run and produced ~200,000 `ECONNREFUSED` 500s.
- **Drain the outbox backlog before measuring reads.** An early read sweep ran while
  `kafka_event_outbox` still had `PENDING` rows, and the in-process relay's cost was being
  attributed to the read path. Reads came in at 1,072–1,425 req/s and were discarded. Check
  `PENDING = 0` on both sides of the window.
- **`tools/load/probe.mts` parses `--target` and `--seconds` as separate argv entries, not `--flag=value`.**
  Passing `--url=` or `--duration=` silently falls back to defaults; because the secret is read the
  same way, `--secret=VALUE` makes it fall back to the default secret and **every request becomes a
  401 while a latency summary still prints.** Always print the full status mix, not `tail -4`.
- **Profile any surprising number before explaining it.** A read sweep reported a 3× regression
  that was really `warnOnPoolMismatch` calling `console.warn` on every request — 13 MB of log
  writes and 3.93 % of CPU, inside the measured window. The obvious explanation (the dataset had
  grown 5.4×) was wrong; the CPU profile found it in one pass. See `docs/CAPACITY.md` §9.3.
- **`packages/redis` is consumed as built output.** Tests and the running gateway resolve
  `packages/redis/dist`, so an A/B that edits `packages/redis/src` without
  `pnpm --filter @roadwatch/redis build` measures the *same* code twice and reports a null result.

## Working conventions

- `pnpm install`, then `docker compose up -d`, `pnpm seed:demo`, `pnpm start:all`.
- Gate before proposing a change: `pnpm typecheck` and `pnpm test` (turbo runs all package tasks).
- Prefer extending an existing pattern over a broad refactor — see `CONTRIBUTING.md`.
- Never commit secrets, keys, or real `.env` files.
- `docs/CAPACITY.md` and `docs/LOAD_TESTING.md` carry measured throughput figures. The load
  generator runs on the same 12 cores as the data plane, so treat **per-request CPU** as the stable
  metric and single-instance throughput as noisy.
- Load and profiling entry points: `pnpm load:probe`, `pnpm profile:read`, `pnpm verify:write-path`,
  `pnpm verify:redis-cost`, `pnpm verify:admission-race`.
