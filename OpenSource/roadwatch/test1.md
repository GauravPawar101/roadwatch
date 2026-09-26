# RoadWatch — Infrastructure, Testing and Optimisation Report

**Date:** 26 September 2026
**Scope:** bug fixing, configuration architecture, test coverage, Kubernetes/podman
deployment, live precedence verification, and load/efficiency measurement.
**Repository:** `roadwatch` (monorepo, pnpm + turbo)
**Baseline commit:** `ed0ead9` → **HEAD `4176722`**

---

## 1. Executive summary

Across 14 commits, 157 files, +5,984 / −1,449 lines:

- **All 17 packages now typecheck** (the gateway alone had 60 errors) and
  **all 17 test tasks pass — 221 tests**. Test files grew from 19 to 32, and
  the number of packages with a runnable `test` task grew from 8 to 12.
- **A fatal availability bug class was eliminated.** A single malformed
  request could hang a client indefinitely *and* terminate the whole API. This
  was reproduced live, root-caused, fixed in two services, and locked with
  regression tests that were verified to fail against the original code.
- **Cloud-first endpoint resolution was proven, not assumed.** An audit showed
  the precedence logic existed but did not reach most connection points. After
  the fix, a live probe writes to a real second Postgres and Redis and confirms
  which server received the data — 12/12 checks.
- **A 76% reduction in Redis commands per write**, measured, with a
  corresponding 15% throughput gain.
- **Load measured at 591 req/s** with a 2.07 s p95 — but with two significant
  measurement caveats documented in §8, one of which materially changes what
  that number means.

The most important finding of this exercise is not a performance number. It is
that **the previously documented configuration behaviour did not match the
actual code**, and that several of the project's own operational scripts had
never worked. Both are now verified by execution rather than inspection.

---

## 2. System and infrastructure

### 2.1 Components

| Component | Image / version | Role | Host port |
|---|---|---|---|
| gateway-api | Node 20+, Express 4 | Public API, auth, complaint lifecycle, SSE | 3100 |
| backend-api | Node 20+, Express 4 | Analytics, complaints, webhooks, image submission | 4001 |
| frontend | React + Vite | Citizen and authority dashboards | 3000 |
| scheduler | Node + node-cron | SLA, karma, reports, offline queue sync | — |
| webhook-handler | Node + kafkajs | Inbound webhook fan-out | — |
| fabric-anchor-consumer | Fabric Gateway SDK | Blockchain anchoring | — |
| media-ingest | Node | Media/proof processing | — |
| Postgres | `postgres:15-alpine` | Primary datastore, 54 tables / 100 indexes | 15433 |
| pgbouncer | `edoburu/pgbouncer` | Transaction-mode pooler | 16432 |
| Redis | `redis:7-alpine` | Idempotency, backpressure, rate limits, cache | 16379 |
| Kafka (events) | `apache/kafka:3.8.0` | Operational events | 9095 |
| Kafka (hlf) | `apache/kafka:3.8.0` | Fabric anchor backpressure | 9094 |
| Prometheus + Grafana | compose | Metrics and dashboards | — |

### 2.2 Kubernetes

Base manifests are layered (`layer-0-platform` … `layer-3-schedule`) with four
overlays: `dev`, `prod`, `aws`, `managed`. All four now render — previously
`prod` never rendered at all (§5.6), and `aws` inherited the fault.

The container runtime is resolved in one place, `ops/lib/container-runtime.sh`.
Podman is the default; Docker remains available via `CONTAINER_RUNTIME=docker`.

### 2.3 Environment constraints (disclosed, not worked around)

kind on **rootless** podman cannot run on this host. Rootless podman is unable
to obtain cgroups by any route tested:

- systemd manager → scopes receive an empty `ControlGroup`, and the `Unit`
  interface exposes no `Delegate` property at all
- cgroupfs manager → container still lands at `/`, read-only cgroupfs
- explicit `--cgroup-parent`, and a transient service with `cpu memory pids`
  delegated

Enabling `cpu memory pids` in
`user.slice/user-1000.slice/user@1000.service/cgroup.subtree_control` did
**not** help. k3s-in-podman was tried as an alternative: the API server starts,
kubelet fails with `mkdir /sys/fs/cgroup/kubepods: permission denied`.

Podman itself works fine for ordinary containers — runc, networking, port
publishing all function. Only cgroup *limits* are unavailable, and kubelet
requires them. **No cgroup capability was spoofed to force a check to pass.**
Kubernetes deployment is therefore unverified end-to-end; the manifests are
validated by rendering, not by running.

---

## 3. Configuration architecture: cloud-first resolution

### 3.1 The contract

`packages/core/src/config/endpoints.ts` defines one precedence order for every
endpoint:

```
managed/cloud  ->  explicit URL  ->  in-cluster parts  ->  built-in local default
```

**Cloud variables are consulted first deliberately.** In Kubernetes the base
manifests always materialise `DATABASE_URL` / `REDIS_URL` / `KAFKA_*_BROKERS`
from the infra ConfigMap. An "explicit URL wins" ordering would therefore be
permanently satisfied by the in-cluster value, and a managed endpoint could
never take effect regardless of configuration. A `*_CLOUD_*` variable is an
explicit statement of deployment intent, so it outranks the generic name.

### 3.2 Variables

| Component | Managed (highest) | Explicit | Parts |
|---|---|---|---|
| Postgres | `DATABASE_CLOUD_URL`, `POSTGRES_CLOUD_URL` | `DATABASE_URL` | `POSTGRES_*` / `PG*` |
| Redis | `REDIS_CLOUD_URL`, `REDIS_MANAGED_URL` | `REDIS_URL`, `REDIS_URI` | `REDIS_HOST`/`PORT`/`PASSWORD`/`DB`/`TLS` |
| Kafka events | `KAFKA_EVENTS_CLOUD_BROKERS`, `KAFKA_EVENTS_MANAGED_BROKERS` | `KAFKA_EVENTS_BROKERS`, `KAFKA_EVENTS_BROKER` | `KAFKA_BROKERS` (events only) |
| Kafka hlf | `KAFKA_HLF_CLOUD_BROKERS`, `KAFKA_HLF_MANAGED_BROKERS` | `KAFKA_HLF_BROKERS`, `KAFKA_HLF_BROKER` | `KAFKA_BROKERS` (retained) |

Resolved tiers are logged at startup with credentials redacted:

```
[scheduler] Endpoints: postgres[cloud] redis[cloud] kafka.events[cloud] kafka.hlf[in-cluster]
```

### 3.3 Verification, not assertion

`tools/verify/cloud-precedence.mts` stands up a second Postgres and Redis (the
`cloud-sim` compose profile) and:

1. writes a row and a Redis key with **both** tiers configured,
2. asks **both** real servers which one received it,
3. repeats with no managed value to confirm the fallback direction.

Expected output: `12/12 checks passed`. The reverse check matters: a resolver
that always preferred "cloud" would pass every forward assertion while leaving
the local stack unusable.

Live confirmation at the service level: the running gateway's own TCP sessions
showed connections to `15434` and `16380` (managed) and **none** to `16432` or
`16379` (in-cluster).

---

## 4. Defects found and fixed

### 4.1 Availability — the most serious class

**Symptom.** A JWT whose `sub` was not a UUID reached Postgres, aborted the
surrounding transaction, escaped the route as an unhandled rejection, and
terminated the process. The client received nothing at all.

**Two independent causes:**

1. `user.sub` flows directly into a `uuid` column with no validation.
2. **No `unhandledRejection` / `uncaughtException` handler existed anywhere in
   the repository.** A single failed request killed the whole API.

**A second, larger instance of the same class.** Express 4 does not catch
rejections from `async` handlers. All **44** route handlers in the gateway are
`async`. A throwing handler therefore left the client hanging indefinitely —
verified: reverting the fix produced 5 test failures with **15-second
timeouts**, which is precisely the hang.

**Fixes**

- `verifyAccessToken` rejects a non-UUID `sub` at the edge (now 401, not a crash).
- `installProcessGuards` in `@roadwatch/core`, wired into all 5 services. Logs
  rejections and keeps serving; exits after 100 so a leaking handler cannot spin
  forever; still exits on `uncaughtException` because state is then undefined.
- `Router()` / `makeAsyncSafe()` wrap every handler so rejections reach error
  middleware. Applied to 12 gateway route modules, 4 backend route modules, and
  both app instances.
- The gateway gained the error middleware and 404 handler it never had.

**Two subtleties, both pinned by tests**

- Express decides a layer is error middleware *solely* from `fn.length === 4`.
  A wrapper that always declared three parameters would make every error handler
  ordinary middleware that silently never runs — turning the fix into an outage.
- `@roadwatch/core` is compiled from source by all consumers under three
  different `moduleResolution` settings. `import type { Request } from 'express'`
  resolves in some and not others. Types are now derived from the default
  import, which resolves everywhere.

### 4.2 Data integrity and correctness

| Service | Defect | Consequence |
|---|---|---|
| gateway | `env.ts` used `X && !X` to detect a default secret; Zod's own default then masked unset `JWT_SECRET` | forgeable-token check could never fire |
| gateway | `zone` column written with the `authorityId` value | wrong data |
| scheduler | `work_band` computed from a fabricated baseline | 9 of 12 score levels in the wrong band |
| scheduler | `report_date` derived in local time | 3 of 3 generated reports misdated |
| scheduler | `syncOfflineQueue` logged success for a queue it had not synced | false success reporting |
| webhook-handler | dedupe keyed on a business key, not event identity | 1 of 4 events handled; 0 of 3 status changes applied |
| webhook-handler | idempotency claim never released | retry and DLQ paths unreachable |
| webhook-handler | read `event.txHash` (does not exist) instead of `fabricTxId` | `anchored_tx_hash` always NULL |
| backend-api | JWT middleware hardcoded `aud`/`iss` | every gateway-issued token rejected with 401 |
| backend-api | `getActorId` returned 401 to mesh sidecars | service-to-service calls broken |
| fabric-anchor-consumer | called removed Fabric `createTransaction` API | anchoring broken |
| packages | `MerkleAnchorBatch` cast to a type it is not | real mismatch hidden |
| repo | 22 committed build artifacts shadowed `.ts` sources | stale `.js` silently loaded over real source |

### 4.3 Configuration defects

| Defect | Consequence |
|---|---|
| `packages/core/src/postgres.ts` read `DATABASE_URL` directly | **backend-api could not be pointed at a managed database at all** |
| `packages/core/src/postgres-adapter.ts` | same, plus ambiguous connection-string/parts precedence |
| `fabric-anchor-consumer` read `env.DATABASE_URL` with hardcoded fallback | managed endpoint ignored |
| `packages/redis/config.ts` duplicated the precedence chain | free to drift from the resolver |
| `packages/kafka/config.ts` did the cloud lookup twice | duplicated, divergent logic |
| `getRedisConfig` cached globally, ignoring its `env` argument | second call returned the first call's URL |
| `getKafkaConnectionMode`'s error branch was unreachable | masked by a hardcoded `127.0.0.1:9095` default |
| gateway `assertRequiredInfrastructure` checked only in-cluster vars | **refused to boot when configured solely with managed Redis and Kafka** |
| Managed endpoints got no TLS | connection would fail against any real provider |
| `NOTIFICATION_DISPATCH_INTERVAL_MS` in ConfigMap vs `NOTIFICATIONS_DISPATCHER_INTERVAL_MS` in code | dispatcher ran on default cadence regardless of config |

### 4.4 Operational scripts that had never worked

- `ops/dev/compose.sh` used `exec rt_compose "$@"`. `exec` cannot execute a
  shell function, so **every invocation failed with "not found"** and
  `pnpm infra:up` never started anything.
- `run-k6.mjs` signed tokens with `JWT_SECRET` where the gateway verifies
  `ACCESS_SECRET` → every request rejected as forged.
- `run-k6.mjs` defaulted to the frontend on `:3000`, not the API on `:3100`.
- Both load harnesses' `.env` readers matched only `KEY=` and silently ignored
  the `KEY:` form.
- The k6 script minted `sub: 'loadtest-user'` — not a UUID, so no uuid column
  could ever accept it. The test could not have passed.
- The `prod` overlay never rendered (stray `namespace: roadwatch` rewrote the
  observability Namespace, producing an ID conflict). `aws` inherited it.

---

## 5. Test coverage

| Package | Tests |
|---|---|
| `@roadwatch/core` | 72 |
| `@roadwatch/gateway-api` | 29 |
| `@roadwatch/redis` | 27 |
| `@roadwatch/backend-api` | 21 |
| `@roadwatch/fabric-anchor-consumer` | 20 |
| `@roadwatch/scheduler` | 17 |
| `roadwatch-frontend` | 14 |
| `@roadwatch/kafka` | 10 |
| `@roadwatch/webhook-handler` | 9 |
| `@roadwatch/adapters` | 2 |
| **Total** | **221** |

Every regression test added this exercise was **verified to fail against the
original code**, by reverting the fix and re-running. Specifically:

- async-rejection tests → fail with 15 s timeouts (the hang)
- cloud-first pool tests → fail when the cloud-blind read is restored
- the async-safe-router invariant → fails if any route file reverts to
  `express.Router()`
- webhook dedupe tests → fail against each reintroduced bug

A pre-existing test weakness was found and corrected:
`adaptive-backpressure.test.ts` re-implemented the pressure arithmetic locally,
so it would pass regardless of what the real function did. The new cache tests
drive the real `resolveAdaptiveLimits` against a mocked client and count
round-trips.

---

## 6. Load and efficiency testing — methodology

### 6.1 Profile

`tests/load/k6/complaints.js`, ramping VUs: 30 s → 100, 60 s → 500, 60 s → 1000,
30 s → 0. Each iteration: `GET /health`, then `POST /authority/complaints`, then
sleep 1 s.

### 6.2 Three traps that each produce a convincing false failure

These are documented because each was hit during this work, and each produces
numbers that look like a capacity problem.

1. **Loopback bind.** k6 runs in a container and reaches the host via the
   gateway *address*. A gateway bound to `127.0.0.1` is invisible. Signature:
   `100% failure` with **`data_received: 0 B`** — requests never arrived.
2. **Container→host addressing under podman.** Rootless podman does not route
   to the host over its bridge gateway (`10.0.2.2` unreachable). Requires
   `--add-host=host.containers.internal:host-gateway` or `--network host`.
3. **The write limiter absorbs the whole test.** `COMPLAINT_WRITE_MAX_PER_MINUTE`
   defaults to **120** and `COMPLAINT_WRITE_MAX_INFLIGHT` to **24**. At the
   default, a 1000-VU test is capped near 120 writes/min and everything else is
   **429**. The k6 summary then reports ~50% failure unrelated to capacity.

### 6.3 Measurement discipline

- Resource sampling targets the process that **owns the listening socket**,
  resolved via `ss -ltnp`. An earlier attempt sampled tsx's thin wrapper and
  reported ~0 RSS — a plausible-looking but entirely fictitious number.
- `redis-cli CONFIG RESETSTAT` before each run, so command counts are per-run.
- Container figures come from `podman stats` sampled at 1 Hz.
- Both directions of precedence verified, so the probe cannot be satisfied by a
  one-sided implementation.

---

## 7. Measured results

### 7.1 Throughput and latency (limiter raised to 60,000/min, 400 inflight)

| Metric | Value |
|---|---|
| Throughput | **591 req/s** |
| Requests | 106,888 |
| `GET /health` pass rate | **100%** |
| `POST` accepted (200) | 28,887 (**54%**) |
| `POST` rejected (429) | 24,557 (**23%**) |
| Latency p50 / p90 / p95 | 23 ms / 576 ms / **2.07 s** |
| Bytes in / out | 43 MB / 37 MB |

### 7.2 Resource cost

| Component | Peak CPU | Peak memory |
|---|---|---|
| Gateway process | 124.6 CPU-seconds total | 384 MB median / 408 MB peak |
| **Gateway per request** | **2.33 ms CPU** | — |
| Postgres (managed stand-in) | 26.7% | 204 MB |
| Kafka — events | 12.9% | 481 MB |
| Kafka — hlf | 12.7% | 481 MB |
| Redis | 4.7% | 16 MB |
| pgbouncer | 0.7% | 6 MB |
| **Data plane total** | **~60%** | — |
| **Load generator (k6, capped 4 CPU)** | **100.9%** | 374 MB |

**The load generator consumed more CPU than the entire data plane combined.**
The data plane was not the bottleneck.

### 7.3 Efficiency change: Redis commands per write

The write path takes **two** admission permits (route-scoped and global). Each
called `resolveAdaptiveLimits`, which read three load-signal keys and wrote the
effective limits back — four round-trips per permit, eight per write, to obtain
a value that changes on the scale of seconds. The limits are now memoized
in-process for 2 s (`COMPLAINT_WRITE_LIMITS_CACHE_MS`, `0` disables), keyed by
bounds so services sharing a Redis cannot read each other's numbers.

Identical profile, before and after:

| Metric | Before | After | Change |
|---|---|---|---|
| Redis commands per write | 36.7 | **8.7** | **−76%** |
| Redis `GET` calls | 668,769 | 4,560 | **−99.3%** |
| Throughput | 512 req/s | **591 req/s** | +15% |
| Writes accepted | 16,929 (36%) | **28,887 (54%)** | +71% |
| Failure rate | 31.7% | 23.0% | −27% |

### 7.4 Two findings that change how the numbers should be read

**(a) The load test measured the merge path, not the insert path.**

The create route deduplicates by proximity: any complaint within
`MERGE_RADIUS_M = 100` metres of an existing open complaint in the same
district and zone is *merged* into it. The k6 payload uses constant
coordinates (`18.52, 73.85`), so every request matched the first complaint.

Verified in the database after the run:

```
complaints:           1 row   (report_count = 38638)
api_idempotency_keys: 38638 rows
```

So **591 req/s is the throughput of the idempotency + proximity-merge path.**
The `INSERT` path was exercised effectively once. This is correct product
behaviour — a citizen complaint system should not create 38,000 rows for one
pothole — but it means **insert throughput is currently unmeasured.**

**(b) The adaptive limiter takes its own 429 count as a pressure input.**

`resolveAdaptiveLimits` shrinks capacity on outbox depth, recent 429s and recent
5xx. Under load it settled at:

```json
{"maxRequestsPerWindow":37500,"maxInflight":250,"pressure":2}
```

despite `COMPLAINT_WRITE_MAX_PER_MINUTE=60000`.

429s raise the pressure score → lower the ceiling → cause more 429s. Under
sustained load this ratchets to the configured floor and the configured maximum
becomes unreachable. This is why raising the limit during testing appeared to
do nothing. It was **documented but deliberately not changed** — the back-off may
be intentional, and the fix is a production-intent decision (§11).

---

## 8. Optimisation pass

Run after the report above was first written, to reduce latency and increase
throughput. Four changes, in the order the evidence pointed at them.

### 8.0 First: a profile that could measure inserts

As §7.4(a) showed, the checked-in profile merged every request into one
complaint. `tests/load/k6/complaints-insert.js` spreads coordinates across a
grid with ~200 m spacing (grid pitch must exceed the 100 m merge radius) and
asserts `merged === false`, so a run that silently collapses back onto the
merge path fails its own thresholds.

Two bugs in writing it, both of which produced *flattering* output:

- `encoding.b64encode` rejects a `charCodeAt` array. Every iteration threw
  after the health check, and k6 reported the run as **100% successful** —
  878,521 "iterations", 0 failures, while inserting nothing. Iteration time of
  88 ms against a `sleep(1)` was the only tell.
- The grid index used `__VU * 100000 + __ITER`, which wraps modulo the grid
  size, so different VUs collided onto the same cell.

A third issue was not in the script but in how runs were repeated: the payload
was byte-identical between runs, so `deriveIdempotencyKey` returned the same
key and the gateway correctly replied with a **replay** instead of inserting.
One run reported 12,388 "created" responses against 8,975 rows. That is the
idempotency contract working correctly — the profile was not run-independent.
Fixed with a per-run `RUN_ID`.

After these, every run reconciles exactly: **responses = rows = events sent.**

### 8.1 The proximity-dedupe query was a sequential scan

The create route checks for a nearby existing complaint on every insert. With
no supporting index, `EXPLAIN ANALYZE` at 9,329 rows:

```
Seq Scan on complaints  (actual time=0.033..7.117 rows=9329)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 1405kB
Execution Time: 11.906 ms
```

Full table scan plus a sort, per insert, growing linearly with the table. Added
a partial index on `(district, zone, created_at DESC) WHERE lat IS NOT NULL AND
lng IS NOT NULL` — the query only considers located complaints:

```
Index Scan using complaints_open_dedupe_idx  (actual time=0.048..0.090 rows=25)
Execution Time: 0.152 ms
```

**11.906 ms → 0.152 ms, 78×**, and now O(rows examined) rather than O(table).
238 buffers → 71.

### 8.2 The admission limiter could never leave its floor

§7.4(b) flagged this; it turned out to be worse than "non-deterministic". Under
sustained load the 429 counter drove pressure to its maximum of 4, forcing
`shrink = 1`, so the effective window collapsed to `minRequestsPerWindow` and
inflight to `minInflight`. Because those floors are *derived* as `max / 4`,
raising `COMPLAINT_WRITE_MAX_PER_MINUTE` raised the floor by the same factor
and changed nothing.

The defect is structural: a rejection is the limiter's own **output**, and it
was an input to the score that sets the ceiling. Fixed by removing
`recent429Count` from the pressure calculation. The remaining inputs — outbox
depth and 5xx count — are independent of the limiter's decisions, and both are
transient, so capacity recovers once the backlog drains. The 429 count is still
recorded and exported for observability.

### 8.3 The inflight cap must not exceed the connection pool

Each admitted write holds a connection for its transaction. With inflight 250
against a pool of 20, roughly 230 requests queued per connection and the
2-second acquire timeout produced 31 × HTTP 500 (`timeout exceeded when trying
to connect`).

The shipped defaults — 24 inflight against a pool of 20 — are actually
well matched. The mismatch was created by the test configuration. Two changes:

- `PGPOOL_MAX` now sizes both the gateway pool and the `@roadwatch/core` pool,
  matching the convention `postgres-adapter.ts` already used.
- The constraint is documented at the pool definition, because the two numbers
  live in different services and drift apart silently.

### 8.4 The outbox relay was capped at 25 events/second

This was the actual end-to-end bottleneck, and it was throttling the primary
write path.

`startKafkaEventRelay` drained a fixed **25 rows once per second**. The write
path produced ~54 events/second under load, so the backlog grew without bound:
**18,463 PENDING against 34,052 SENT** after one 3-minute run. That backlog is
read as a pressure signal, so the growing outbox permanently held the limiter
at a reduced ceiling — the async side starving the sync side.

The relay now drains until a batch comes back short, bounded per tick so a large
backlog cannot monopolise the event loop. The loop stops on a partial batch, so
a poison row causes back-off to the next tick rather than a hot spin. Batch
size, interval and batch cap are all environment-configurable.

### 8.5 Results

Insert path, 1000 VUs, 3 minutes, `PGPOOL_MAX=60`, inflight 60:

| Metric | Before | After |
|---|---|---|
| Dedupe query | 11.906 ms | **0.152 ms** (78×) |
| Outbox PENDING after run | 18,463 | **0** |
| Outbox gauge | 19,188 | **0** |
| Accepted inserts | 9,784 | **12,198** (+25%) |
| p95 latency | 567 ms | 628 ms |
| p90 latency | — | 385 ms |
| Max latency | 5.43 s | **2.11 s** |
| HTTP 500s | 31 (connect timeout) | **0** |
| Rows vs responses | did not reconcile | **exact** |

Latency against the original as-found configuration, which admitted 250
concurrent writes against a 20-connection pool:

| Metric | As found | Final |
|---|---|---|
| p95 | 3.06 s | **628 ms** (−80%) |
| Max | 7.25 s | **2.11 s** (−71%) |
| HTTP 500s | 31 | **0** |

Resource cost after optimisation:

| Component | Peak CPU | Peak memory |
|---|---|---|
| Gateway | 2.47 ms CPU per request | 397 MB median / 448 MB peak |
| Postgres (managed) | 32.2% | 340 MB |
| Kafka — events | 12.6% | 542 MB |
| Kafka — hlf | 12.5% | 579 MB |
| Redis | 4.3% | 17 MB |
| pgbouncer | 0.7% | 6 MB |

p95 rose slightly (567 → 628 ms) between the last two runs. That is the
expected cost of admitting 25% more work: the queue is doing its job. Max
latency and 500s both improved substantially, which is the trade that matters.

**Still open.** RSS reached 448 MB (up from 384 MB) and the 429 count still
reaches ~14,700, so the limiter is still the ceiling on accepted writes. The
remaining lever is the pool size against Postgres `max_connections = 100`, and
a real soak test — neither is done here.

---

## 9. Data-flow audit and soak test

### 9.1 What was audited

The complaint create path end to end, because it is the only write that fans
out to every subsystem:

```
POST /authority/complaints
  -> admission control (Redis: 2 permits)
  -> idempotency claim          (Postgres, own statement)
  -> TRANSACTION
       proximity dedupe SELECT ... FOR UPDATE
       INSERT/UPDATE complaints
       enqueueKafkaEvent -> kafka_event_outbox
       ensureSlaTracking -> sla_tracking
       createAndFanoutNotification -> notifications, notification_inbox,
                                       notification_deliveries
  -> COMMIT
  -> release claim / store result
  -> audit, analytics, karma    (outside the transaction)
  -> relay drains kafka_event_outbox -> Kafka -> consumers
       fabric-anchor-consumer: dedupe by idempotencyKey, DLQ after 3 attempts,
                               commit offsets only once every message in the
                               batch is handled
```

Checked: transaction boundaries, idempotency claim lifecycle, outbox
transactional-ness, consumer ack ordering, at-least-once dedupe, and every
place a failure is swallowed.

### 9.2 Four defects found

Each was reproduced against a real database before being fixed.

**Complaint creation was not atomic, and the gap corrupted data.** The
complaint, merge counter, SLA row and outbox event committed together, but the
notification ran on its own transaction *afterwards*. Reproduced by making the
`notifications` table unavailable:

| | Before | After |
|---|---|---|
| Request 1 outcome | 500 | 500 |
| Complaint committed | **yes** | no |
| Outbox event | **yes** | no |
| SLA row | **yes** | no |
| Request 2 (the retry) | 200, `merged: true`, **report_count 2** | 200, `merged: false`, **report_count 1** |

`report_count` feeds escalation decisions and contractor scoring, so this was
silent corruption of business data from a single transient failure. The
notification and SLA writes now enlist in the complaint transaction, and live
SSE broadcasts are deferred until after the commit so a client cannot be shown
a notification that is then rolled back. The post-commit writes that remain —
audit, analytics, karma — are explicitly best-effort and now log on failure:
they are observability, and throwing would convert a durable write into a 500
and re-open this exact path.

**An incomplete idempotency claim was unrecoverable.** A claim is written
before the transaction and completed after it. Anything failing in between left
`response_code IS NULL`, and nothing ever cleaned those rows up. Reproduced by
locking `complaints` so the request stalled after claiming, then `SIGKILL`ing
the gateway:

```
poisoned key: auto:c2c20d84b9636cd1...  orphaned: true  complaints: 0
retry 1 -> 409 {"error":"A request with this idempotency key is already being processed"}
retry 2 -> 409 (identical)
```

Because auto-derived keys hash the request body, the caller could not work
around it — altering the payload derives a different key, so the original
complaint was permanently unwritable. Stale claims are now reclaimed after a
TTL through a conditional `UPDATE` whose `rowCount` decides ownership, so two
concurrent retries cannot both proceed; a clean failure releases the claim
immediately instead of waiting out the TTL. The same poisoned key returned 200
and created the complaint after the fix.

**Contractor karma could be silently and permanently lost.** The adjustment was
four independent statements each wrapped in `.catch(() => null)`, permitting
three distinct corruptions: the score moving with no ledger record; the ledger
recording a delta the score never applied; and a failed score read defaulting
to `0`, so `getWorkBandFromScore(0)` overwrote a real `work_band` with the
lowest one. User karma self-heals on an hourly recalculation built from source
data; **contractor karma has no such path**, so a dropped adjustment was
permanent and invisible. The three writes are now one transaction, the band is
derived from the value just written rather than a second read, and failures are
logged.

**The scheduler dropped escalation events permanently.** `enqueueStatusChangedOutbox`
swallowed failures with `.catch(() => null)` and the caller then set
`breach_notified = true` — the only thing preventing a retry. A transient
failure therefore discarded the event while the database recorded the
escalation as notified. Failures now propagate, so the row stays eligible and
the next cron run retries; a missing outbox table warns rather than returning
silently.

### 9.3 Soak test

`tests/load/k6/soak.js`, 30 minutes at a constant 40 req/s, 1000-VU ceiling
unused. Constant arrival rate rather than constant VUs, so offered load does not
drift as latency changes.

| Metric | Result |
|---|---|
| Duration / offered rate | 30 min @ 40 req/s |
| Requests | 72,002 |
| Failures | 204 (0.28%) |
| Latency p50 / p95 / max | 2.6 ms / **9.5 ms** / 294 ms |
| Checks passed | 99.81% |

**Memory: no leak.** RSS climbed 193 → 239 MB in the first minute and then held
flat for the remaining 29:

```
t+0min  193      t+9min  240      t+17min 241
t+1min  239      t+10min 240      t+29min 241
t+3min  239      t+12min 240
t+4min  242      t+13min 240
t+6min  239      t+15min 240
t+7min  240      t+16min 241
```

First-third average 236 MB, last-third average 241 MB — a 5 MB drift across
~11 minutes, against a 49 MB step in the first 60 seconds. The growth flagged as
a possible leak in §7 was **warm-up**, and the concern is discharged.

**Backlog: none.** `outbox_pending` never exceeded 1 across the whole run, and
the relay drained continuously.

### 9.4 A discrepancy the soak itself caused

The first soak reported 35,797 accepted creates, but the database held **601
rows**. The cause was in the test, not the system: k6 gives every VU its own JS
runtime, so a module-level `let counter = 0` was per-VU. Each VU counted from 1
and produced byte-identical payloads, so 35,400 of the 36,001 requests were
duplicates that idempotency correctly replayed.

That accident turned out to be the strongest validation in this section:

| | |
|---|---|
| Requests | 36,001 |
| Unique payloads | 601 |
| Complaints written | **601** |
| Outbox events sent | **601** |
| SLA tracking rows | **601** |
| Idempotency claims | **601** |
| Orphaned claims | **0** |
| Complaints with `report_count > 1` | **0** |

35,400 duplicate requests produced zero duplicate rows, zero orphaned claims and
zero double-counted reports. That is the idempotency and atomicity work holding
under a realistic retry storm — and it is precisely the property whose absence
caused the `report_count 2` corruption in §9.2.

The profile is fixed to derive uniqueness from `(__VU, __ITER)` and to report
200 and 429 separately; the earlier check accepted either as "2xx", so a run that
was 98% rejected presented as healthy.

Worth recording as a process failure: the fix was initially broken
(`TOTAL_CELLS` referenced but no longer declared) and `node --check` passed it,
because that validates syntax and not references. The soak container reported
`ReferenceError: TOTAL_CELLS is not defined` on every iteration and wrote nothing
— caught only by checking the database, not the exit status. A load script must
be smoke-tested against real writes before its result is believed.

---

## 10. What the numbers do *not* show

Stated explicitly, because each is a real limit on the conclusions above:

- **Insert throughput is unmeasured** (§7.4a). A profile with varying
  coordinates is required.
- **No soak test.** Gateway RSS grew 252 → 408 MB across the run (+62%) without
  plateauing. Possibly normal warm-up of pools and caches; possibly a leak. A
  multi-hour run would distinguish them, and this was not done.
- **Single host, co-resident load generator.** Latency figures are pessimistic
  and contention-affected.
- **Fabric anchoring is untested.** It needs a Fabric Gateway and CA, which have
  no credible hosted free tier.
- **`media-ingest` is not in the profile.**
- **Kubernetes is unverified at runtime.** Manifests render; the cluster never
  ran (§2.3).
- **Vendor free-tier limits** were read from vendor pages on 26 Sep 2026 and
  change without notice.

---

## 11. Tradeoffs

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Cloud vs explicit precedence | Cloud first | Explicit first | k8s always sets `DATABASE_URL`; the other order makes managed endpoints unreachable |
| Unhandled rejection | Log, keep serving, exit at 100 | Exit immediately | One failed request does not corrupt state; 100 avoids infinite spin |
| `uncaughtException` | Exit 1 | Keep serving | State is undefined; continuing is unsafe |
| Express 4 + handler wrapping | Wrap | Upgrade to Express 5 | Express 5 fixes this natively, but path-to-regexp and API changes make it a migration, not a patch |
| Error-handler arity | Preserve 4 params | Normalise | Express keys on `fn.length === 4`; normalising silently disables all error handling |
| Limit cache TTL | 2 s | None / per-request | 2 s costs negligible freshness; saves 8 round-trips per write |
| pgbouncer with managed DB | Bypassed (direct) | Force through pgbouncer | A managed URL points at the database; providers offer their own poolers |
| `docker-compose.yml` | **Kept** | Delete in favour of k8s | It is the only *verified-working* local stack; the k8s replacement could not be run |
| Adaptive limiter 429 feedback | **Left as-is** | Remove 429 from pressure | May be deliberate back-off; changing it is a production-intent call |
| Kind on podman | Not spoofed | Force past preflight | Spoofing a capability check hides a real limitation |

### Costs accepted

- **Rootless-podman Kubernetes remains unverified.** The manifests are correct
  as far as rendering and review can establish, and no stronger claim is made.
- **~8.7 Redis commands per write** remain, because each write takes two
  admission permits. Collapsing to one permit is the obvious next win (§11).
- **Kafka costs ~962 MB** for two clusters in development, more than both
  Postgres instances combined. One cluster suffices for development.
- **Managed Postgres bypasses pgbouncer**, so connection count is bounded only
  by each process's pool (`max: 20`). Provider connection limits must be checked
  before scaling replicas.

---

## 12. Going forward — optimisation plan

Ordered by expected value. Items 1 and 2 are prerequisites for measuring
anything else honestly.

### 1. Measure insert throughput — DONE, see §8.0

Add a k6 scenario that varies coordinates (or omits them) so proximity dedupe
does not collapse every write into one complaint. Until this exists, the insert
path has no performance number and no regression guard.

*Why first:* §7.4a. Every optimisation below targets the insert path, and it is
currently unmeasured.

### 2. Fix the 429 feedback loop — DONE, see §8.2

Either exclude the 429 signal from the pressure score, or give the shrink a
floor and decay so it can recover. For stable capacity testing, pin
`COMPLAINT_WRITE_MIN_PER_MINUTE` equal to `MAX` so there is no span to shrink.

*Why:* a non-deterministic ceiling makes every capacity measurement unstable,
and the configured maximum is currently unreachable under sustained load.

### 3. Add a reconciliation for contractor karma — NEW

Contractor karma moves only by individual deltas and, unlike user karma, has no
recalculation from source. The writes are now atomic and logged, but a
reconciliation that rebuilds the score from `karma_ledger` would bound the blast
radius of any future gap.

*Why:* the ledger is the durable record; nothing currently verifies the
denormalised score against it. Cheap to add, and it closes the class rather
than the instance.

### 3b. Collapse the two admission permits to one

Each write takes a route-scoped and a global permit; each permit costs
INCR/INCR/DECR. The global permit appears to exist as a cluster-wide ceiling,
which the route-scoped one may already provide.

*Why:* the largest remaining Redis cost, at 9.7 commands per write. A direct
multiplier on command-metered plans — at that rate Upstash's 500,000
commands/month free tier allows roughly 51,000 writes/month, and halving the
permits roughly doubles it.

### 4. Longer soak — PARTIALLY ANSWERED

A 30-minute soak at 40 req/s found no leak: RSS steps up in the first minute
and is then flat (see §9.3). What a 30-minute run cannot exclude is a leak with a
multi-hour time constant.

*Why:* still worth an overnight run before trusting the process in a long-lived
deployment, but the evidence so far points to warm-up rather than a defect.

### 5. Bound the Postgres write path

Options, in order of preference: `pgbouncer` restored in front of the managed
database; batch inserts; or a `UNLOGGED` staging table for the ingest path.

*Why:* the insert path is one transaction per complaint plus an outbox row, and
Postgres was the largest data-plane CPU consumer at 26.7%.

### 6. Right-size Kafka

Run a single cluster in development; measure per-topic retention. Both clusters
idle at ~13% CPU and 481 MB each.

### 7. Then, and only then, tune the read path

`GET /health` passed 100% at full ramp because it touches neither Postgres nor
Redis. Real read queries have not been measured at all. Any read-path tuning
before this would be optimising an unmeasured workload.

### Also outstanding

- Runtime-verify the Kubernetes manifests on a host with working cgroup
  delegation.
- Add index-coverage checks for the query patterns the load profile exercises.
- Raise the scheduler and webhook-handler test density toward the gateway's,
  since they carry cron and consumer logic with thin coverage.

---

## 13. Reproducing this work

```bash
# Gate: 17 typecheck + 17 test + builds
npx turbo run typecheck test build

# Data plane (project's own compose, podman by default)
./ops/dev/compose.sh up -d postgres pgbouncer redis kafka-hlf kafka-events

# Managed stand-ins, for precedence verification
./ops/dev/compose.sh --profile cloud-sim up -d managed-postgres managed-redis

export DATABASE_CLOUD_URL='postgresql://postgres:postgres@127.0.0.1:15434/roadwatch'
export REDIS_CLOUD_URL='redis://127.0.0.1:16380/0'
pnpm tsx tools/verify/cloud-precedence.mts      # expect 12/12

# Load test — note the non-watch start and the raised limits
HOST=0.0.0.0 COMPLAINT_WRITE_MAX_PER_MINUTE=60000 COMPLAINT_WRITE_MAX_INFLIGHT=400 \
  pnpm --filter @roadwatch/gateway-api exec tsx src/index.ts &

SECRET=$(node -e "import('./tools/load/resolve-target.mjs').then(m=>console.log(m.resolveAccessSecret()))")
podman run --rm --add-host=host.containers.internal:host-gateway \
  -e TARGET_URL="http://host.containers.internal:3100" \
  -e JWT_SECRET="$SECRET" -e ACCESS_SECRET="$SECRET" \
  -v "$PWD:/work:ro" -w /work --cpus=4 --memory=2g \
  docker.io/grafana/k6:latest run --quiet tests/load/k6/complaints.js
```

Further reading: [`docs/MANAGED_SERVICES.md`](../../docs/MANAGED_SERVICES.md),
[`docs/LOAD_TESTING.md`](../../docs/LOAD_TESTING.md),
[`docs/INFRA_CONFIG.md`](../../docs/INFRA_CONFIG.md).

---

## 14. Commit history

| Commit | Subject |
|---|---|
| `2a20f18` | chore(repo): stop tracking compiled output emitted next to sources |
| `5fb0908` | fix(frontend): clear TypeScript errors and add a test suite |
| `39cb3ff` | feat(core): resolve infrastructure endpoints with cloud/local fallback |
| `b0caffd` | feat(core): add process guards and an async-safe Express router |
| `cef90a1` | fix(gateway-api): correct auth validation, data integrity and request handling |
| `0eb7ff7` | fix(backend-api): accept gateway-issued tokens and correct actor derivation |
| `ebd2d3b` | fix(services): correct scheduler scoring, webhook dedupe and Fabric anchoring |
| `dcf1f85` | fix(packages): resolve type errors and Fabric API misuse in shared packages |
| `71f9821` | feat(ops): make podman the default container runtime and fix the k6 harness |
| `3ddb3bc` | fix(k8s): render every overlay and wire endpoint config into ConfigMaps |
| `60a0768` | fix(core): route every connection point through the endpoint resolver |
| `83f5efe` | test(core): add a live probe proving managed endpoints take precedence |
| `387553e` | perf(redis): stop re-resolving adaptive limits on every request |
| `4176722` | docs: document managed infrastructure, free tiers and measured efficiency |

Nothing has been pushed.
