# Load and efficiency testing

How to run the checked-in k6 profile against a local stack, what the numbers
mean, and the three configuration traps that produce a run which looks like a
capacity failure but is not.

All figures below were measured on this repository on 26 September 2026, 3
minutes, ramping to 1000 VUs, on a 16 GB Linux host.

---

## Four traps that produce fake failures

### 1. The gateway must not be bound to loopback

k6 runs in a container and reaches the host through the gateway *address*, not
`127.0.0.1`. A gateway bound to loopback is invisible to it. The symptom is
distinctive:

```
http_req_failed......: 100.00%  2672278 out of 2672278
data_received........: 0 B  0 B/s
```

**Zero bytes received** with 100% failure means the requests never arrived, not
that the service was slow. Bind `0.0.0.0`:

```bash
HOST=0.0.0.0 pnpm --filter @roadwatch/gateway-api exec tsx src/index.ts
```

### 2. Container-to-host addressing under podman

Rootless podman does not route to the host over its bridge gateway. Use the
host alias:

```bash
podman run --rm --add-host=host.containers.internal:host-gateway ...
```

`--network host` also works and sidesteps the question entirely. With Docker the
same flag is harmless.

Verify before committing to a 3-minute run — it costs two seconds:

```bash
podman run --rm --add-host=host.containers.internal:host-gateway \
  alpine:3.20 wget -qO- http://host.containers.internal:3100/health
```

### 3. The write rate limiter will absorb the whole test

The complaint write path is protected by an adaptive limiter. Its defaults are
deliberately conservative:

| Variable | Default | Meaning |
|---|---|---|
| `COMPLAINT_WRITE_MAX_PER_MINUTE` | `120` | requests per window per principal |
| `COMPLAINT_WRITE_MAX_INFLIGHT` | `24` | concurrent in-flight writes |

At the default, a 1000-VU test is capped near 120 writes per minute and every
other request is rejected with **429**. The k6 summary then reports ~50% failure
that has nothing to do with capacity — the limiter is doing its job.

### 4. Inflight above the pool size turns 429s into 500s

Each admitted write holds a connection for the length of its transaction. If
the inflight cap exceeds the connection pool, the surplus queues and then fails
on the acquire timeout. Measured with inflight 250 against a pool of 20:

```
[gateway-api] unhandled request error: Error: timeout exceeded when trying to connect
31 x HTTP 500
```

p95 was 3.06 s and max 7.25 s. With inflight matched to the pool, p95 fell to
628 ms and the 500s disappeared. **Raise `PGPOOL_MAX` and
`COMPLAINT_WRITE_MAX_INFLIGHT` together**, and remember Postgres defaults to
`max_connections = 100` across all pools on one database.

For a capacity measurement:

```bash
export PGPOOL_MAX=60
export COMPLAINT_WRITE_MAX_PER_MINUTE=60000
export COMPLAINT_WRITE_MAX_INFLIGHT=60
```

Keep the shipped defaults for anything meant to behave like production.

---

## Two profiles, and why there are two

| Profile | Path it exercises | Use it for |
|---|---|---|
| `complaints.js` | idempotency + proximity **merge** | read/health behaviour, merge throughput |
| `complaints-insert.js` | the **INSERT** | write-path capacity |

`complaints.js` sends a constant `lat`/`lng`, and the create route merges any
complaint within `MERGE_RADIUS_M` (100 m) of an existing open one. Every
request therefore merges into the first, and the insert path is never reached —
a 3-minute run produced **one** complaint row with `report_count = 38638`.

`complaints-insert.js` spreads coordinates over a ~200 m grid and asserts
`merged === false`, so a run that silently collapses back onto the merge path
fails its own thresholds. Use it for any capacity claim about writes.

**Always reconcile the numbers.** `k6` reports successful responses; the
database reports rows. They must match. If they do not, something is being
replayed or merged — see the traps below.

### Traps that produce *flattering* results

These are worse than the failing ones, because they look like success.

- **A throwing script reports 100% success.** `encoding.b64encode` in k6
  accepts a string, `[]byte` or `ArrayBuffer` — not a `charCodeAt` array. If
  the iteration throws after the first request, k6 counts the health check as
  the whole iteration. Symptom: a high iteration count, `http_req_failed: 0%`,
  and an iteration duration far below the profile's `sleep`.
- **Idempotent replays across runs.** `deriveIdempotencyKey` hashes the body, so
  a byte-identical payload returns the *previous* run's stored response with
  `200` and inserts nothing. Always pass a unique `RUN_ID`.
- **A wrapping grid.** `(__VU * STRIDE + __ITER) % CELLS` collides once
  `VU * STRIDE` exceeds `CELLS`, putting different VUs on one cell. `STRIDE`
  must exceed the iterations one VU performs.

---

## Running it

```bash
# 1. Data plane
./ops/dev/compose.sh up -d postgres pgbouncer redis kafka-hlf kafka-events

# 2. Gateway, reachable from a container.
#    Use `tsx src/index.ts`, NOT `pnpm dev` — the dev script is `tsx watch`,
#    which restarts on any file change and will silently reset your load run.
#
#    PGPOOL_MAX and the inflight cap must stay in step. Each admitted write
#    holds a connection for its transaction, so an inflight cap well above the
#    pool turns cheap 429s into multi-second waits and then 500s on
#    connection-acquire timeout.
HOST=0.0.0.0 \
PGPOOL_MAX=60 \
COMPLAINT_WRITE_MAX_PER_MINUTE=60000 \
COMPLAINT_WRITE_MAX_INFLIGHT=60 \
  pnpm --filter @roadwatch/gateway-api exec tsx src/index.ts &

# 3. Confirm it is up
curl -s localhost:3100/health

# 4. Clear prior state so runs are independent
podman exec roadwatch_managed_postgres psql -U postgres -d roadwatch \
  -c "TRUNCATE complaints, api_idempotency_keys, kafka_event_outbox CASCADE;"
podman exec roadwatch_managed_redis redis-cli FLUSHALL
# 4. Load — pick the profile, and make the run unique
SECRET=$(node -e "import('./tools/load/resolve-target.mjs').then(m=>console.log(m.resolveAccessSecret()))")
RUN_ID="run-$(date +%s)"
podman run --rm --add-host=host.containers.internal:host-gateway \
  -e TARGET_URL="http://host.containers.internal:3100" \
  -e JWT_SECRET="$SECRET" -e ACCESS_SECRET="$SECRET" -e RUN_ID="$RUN_ID" \
  -v "$PWD:/work:ro" -w /work --cpus=4 --memory=2g \
  docker.io/grafana/k6:latest run --quiet tests/load/k6/complaints-insert.js

# 5. Reconcile: responses must equal rows
podman exec roadwatch_managed_postgres psql -U postgres -d roadwatch \
  -tAc "SELECT count(*) FROM complaints;"
```

`pnpm loadtest` wraps this. The runner warns loudly rather than proceeding if it
would sign with the development default secret.

---

## Measured results

### Insert path (`complaints-insert.js`), after optimisation

1000 VUs, 3 minutes, `PGPOOL_MAX=60`, inflight 60. Responses, rows and
published events all reconcile exactly:

| Metric | Value |
|---|---|
| Accepted inserts | **12,198** |
| Rejected (429) | 48,610 |
| Latency p50 / p90 / p95 | 95 ms / 385 ms / **628 ms** |
| Max latency | **2.11 s** |
| HTTP 500s | **0** |
| Outbox PENDING after run | **0** |
| Gateway CPU per request | 2.47 ms |
| Gateway RSS | 397 MB median / 448 MB peak |

### What the optimisation pass changed

| Metric | Before | After |
|---|---|---|
| Dedupe query | 11.906 ms (seq scan) | **0.152 ms** (index) — 78x |
| Outbox PENDING after run | 18,463 | **0** |
| Accepted inserts | 9,784 | **12,198** (+25%) |
| p95 latency | 3.06 s | **628 ms** (-80%) |
| Max latency | 7.25 s | **2.11 s** (-71%) |
| HTTP 500s | 31 (connect timeout) | **0** |

Full analysis, including the three bugs found in the new profile itself, is in
[`OpenSource/roadwatch/test1.md`](../OpenSource/roadwatch/test1.md) section 8.

### Resource cost

| Component | Peak CPU | Peak memory |
|---|---|---|
| Gateway process | 150 CPU-seconds total | 397 MB median (448 MB peak) |
| Gateway per request | **2.47 ms CPU** | — |
| Postgres (managed stand-in) | 32.2% | 340 MB |
| Kafka — events | 12.6% | 542 MB |
| Kafka — hlf | 12.5% | 579 MB |
| Redis | 4.3% | 17 MB |
| pgbouncer | 0.7% | 6 MB |
| **Data plane total** | **~63%** | — |

The load generator (k6) used more CPU than the entire data plane combined. The
data plane was never the bottleneck; the application and the limiter were.

### Reading the results honestly

- **p95 of 628 ms is the queue, not the work.** With inflight matched to the
  pool there is no connection queueing; the tail is the transaction plus the
  Kafka publish inside it.
- **Acceptance is still ~20%.** The limiter remains the ceiling on accepted
  writes, which is the intended behaviour under a 1000-VU stampede.
- **Gateway RSS reached 448 MB and did not plateau.** Possibly warm-up, possibly
  a leak. A soak test would distinguish them and has not been run.

---

## The adaptive limiter: a control loop around its own output

`resolveAdaptiveLimits` shrinks capacity on genuine pressure — outbox backlog
and upstream 5xx. It previously also shrank on `recent429Count`, and **a
rejection is the limiter's own output.** Rejections raised the pressure score,
which lowered the ceiling, which caused more rejections. Under sustained load
this ratcheted to the floor and could not recover:

```json
{"maxRequestsPerWindow":15000,"maxInflight":100,"pressure":4}
```

`pressure: 4` is the maximum, forcing `shrink = 1`, so the effective limits
collapsed to the floors. Those floors are *derived* as `max / 4`, so raising
`COMPLAINT_WRITE_MAX_PER_MINUTE` raised the floor identically — the configured
maximum was structurally unreachable, which is why raising it appeared to do
nothing.

Fixed: `recent429Count` is no longer a pressure input. Outbox depth and 5xx
count remain, both independent of the limiter's decisions and both transient, so
capacity recovers once the backlog drains. 429s are still recorded and exported
for observability.

Inspect the live decision at any time:

```bash
podman exec <redis> redis-cli GET roadwatch:backpressure:adaptive:effective
```

---

## Efficiency: Redis commands per write

The largest single win found by this exercise.

The write path takes **two** admission permits (one route-scoped, one global).
Each permit called `resolveAdaptiveLimits`, which read three load-signal keys
and wrote the effective limits back. That is four Redis round-trips per permit,
eight per write, purely to obtain a value that changes on the scale of seconds.

Measured, same profile, before and after memoizing the resolved limits for 2s:

| Metric | Before | After | Change |
|---|---|---|---|
| Redis commands per write | 36.7 | **8.7** | −76% |
| Redis `GET` calls | 668,769 | 4,560 | −99.3% |
| Throughput | 512 req/s | **591 req/s** | +15% |
| Writes accepted | 16,929 (36%) | **28,887 (54%)** | +71% |
| Failure rate | 31.7% | 23.0% | −27% |

Tune with `COMPLAINT_WRITE_LIMITS_CACHE_MS` (default `2000`, `0` disables).

This also directly determines how much of a command-metered Redis free tier you
get — see [MANAGED_SERVICES.md](./MANAGED_SERVICES.md#upstash).

```bash
# live command counts
podman exec <redis-container> redis-cli INFO commandstats | grep cmdstat

# what the limiter decided, and why
podman exec <redis-container> redis-cli GET roadwatch:backpressure:adaptive:effective
```

---

## Other efficiency observations

- **Kafka dominates memory.** 481 MB per cluster, ~962 MB for both, more than
  both Postgres instances combined. Running a single cluster in development
  saves half of that.
- **pgbouncer is bypassed when a managed database is used** — it measured 0.7%
  CPU because no traffic went through it. Expect to rely on the provider's own
  pooler; see [MANAGED_SERVICES.md](./MANAGED_SERVICES.md#pgbouncer-is-bypassed-when-you-use-a-managed-database).
- **Read and write paths are not comparable.** `GET /health` passed 100% of the
  time at full ramp because it touches neither Postgres nor Redis. Any profile
  dominated by reads will flatter the system; the write path is the real test.

---

## What is not covered

- The Fabric anchoring consumer is not in this profile. It needs a Fabric
  Gateway and CA, which have no free hosted tier.
- `media-ingest` is not in this profile.
- No soak test was run. Gateway RSS reached 448 MB without plateauing; a
  multi-hour run should be done before trusting the process in a long-lived
  deployment.
- Results are from a single host with the load generator co-resident, which
  was itself using more CPU than the entire data plane. A distributed
  generator would give cleaner latency numbers.
- The pool was raised to 60 against Postgres `max_connections = 100`. The
  remaining throughput ceiling is the pool/connection budget, which has not
  been swept.
- Read-path queries are unmeasured. `GET /health` touches neither Postgres nor
  Redis, so a read-dominated profile would flatter the system.
