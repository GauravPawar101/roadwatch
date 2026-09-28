# Capacity findings: can this system do 10k TPS?

**Date:** 26 September 2026, updated 27 September 2026, re-measured 28 September 2026 (§8)
**Question:** 10,000 transactions per second, or larger. Since updated to a
100,000 req/s target for an AWS EKS/EC2 deployment.

**Short answer:** not on this host, and not by scaling out alone. Two
independent walls, only one of which is hardware. The 100k req/s case adds a
third wall that is not a matter of tuning at all — see §0. §8 re-measures the
ceilings on a larger dataset and finds two further walls that are neither
hardware nor tuning: a read cache that every write invalidates, and a write path
that needs two database connections per request.

Everything below is measured, not estimated. Method and raw numbers are in
`tests/load/k6/capacity.js` and `tools/load/probe.mts`; each figure names the
configuration that produced it.

---

## 0. The 100,000 req/s target

**Redis cannot be Upstash at this rate, and no number of accounts changes that.**
The free tier allows 500,000 commands a month — an average of **0.193 requests
per second**. At the 2.00 commands per write measured after the admission
collapse, that is **0.096 writes per second**. 100,000 writes/s needs 518
*billion* commands a month: about **1,036,800× the free tier**, and far past any
plan Upstash sells. Redis has to be self-hosted (Redis Cluster / ElastiCache) at
that rate. Upstash remains a reasonable fit for a pilot and for development.

**CPU, from the measured per-request costs in §2:**

| Target | App CPU required | ~12-core hosts |
|---|---|---|
| 100,000 **reads**/s | 96 cores | 8 |
| 100,000 **writes**/s | 830 cores | 69 |

Reads have no shared serialisation point, so they scale linearly once the
per-request cost is where it should be. Writes do not: Postgres does not scale
writes past a single node without sharding, and §3 is still unfixed.

**Two things must not be conflated.** *Per-request CPU cost* is what decides the
fleet size, and it is what §1 below now measures. *Single-instance throughput on
this host* is a different number and is bounded by one core. A fix that cuts
per-request cost by 7× barely moves single-instance throughput if the instance is
already saturated — it shows up as headroom, which is what lets the next instance
or the next core carry more.

**The honest position:** 100k reads/s is a horizontal-scaling exercise and looks
reachable from the current per-request cost. 100k writes/s is a re-architecture —
sharded Postgres, an asynchronous write path, and probably not Node on the hot
path. Neither is a configuration change.

---

## 1. Per-request cost, measured 27 September 2026

Profiled with the V8 sampling profiler against the **built** output, at a fixed
concurrency, on the on-device stack. `npm run profile:read`,
`npm run load:probe`, analysed with `tools/profile/summarise.ts`.

Per-request CPU is the number that matters, so it is reported alongside
throughput — at one saturated core the two move together, but only the first
transfers to a fleet.

| Path | Before | After | Change |
|---|---|---|---|
| **Read** — throughput | 123 req/s | **754–1,068 req/s** | ~7× |
| **Read** — CPU per request | 10.7 ms | **1.46–1.90 ms** | −83% |
| **Read** — p50 | 124 ms | **15.0 ms** | −88% |
| **Write** — throughput | 140.6 writes/s | **245.3 writes/s** | +74% |
| **Write** — CPU per write | 9.31 ms | **4.80 ms** | −48% |
| **Write** — p50 | 50.8 ms | **27.7 ms** | −45% |

Read throughput varies run to run (754–1,068 over four runs) because the load
generator shares the same 12 cores as Postgres and the gateway. The CPU-per-request
figure is the stable one.

### What was actually costing the time

Five findings, in the order they were worth:

1. **`?limit=20` was ignored.** `GET /authority/complaints` accepted a `limit`
   parameter that nothing read, and the SQL carried a hardcoded `LIMIT 200`. Every
   client asking for 20 rows received 200: 62,010 bytes per response, 600
   timestamp parses per request. 23.8% of CPU was `JSON.stringify`, 14.5% UTF-8
   conversion, 8.3% date parsing — all of it scaling with row count. This was an
   API-contract violation as much as a performance bug. **Alone: 3.4× throughput.**

2. **A crypto key was built per request.** `jwt.verify` was given the secret as a
   string, so `jsonwebtoken` re-derived a key object on every call. Measured
   80.9 µs/op with a string, 22.2 µs/op with a pre-built `KeyObject`. At 10,000
   req/s that is 80.9% versus 22.2% of a core. `createPublicKey` was 8.6% of
   process CPU and is now absent from the profile. At 850 req/s this is worth only
   ~2% of throughput — it matters at the target rate, not at the current one.

3. **Every request was logged.** `morgan('dev')` wrote a formatted line to stdout
   per request. At 100,000 req/s that is not observability, it is 100,000 log
   lines a second formatted on the event loop. Now opt-in via `LOG_REQUESTS`.
   **Worth 11% of per-request CPU.**

4. **`isRedisConfigured()` re-resolved the endpoint on every write**, walking the
   precedence chain to answer a question whose answer cannot change while the
   process runs. Reached only via the read-cache invalidation. Memoized.

5. **UUIDv7 generation used a synchronous CSPRNG call per identifier** — 4.1% of
   write CPU. Randomness is now drawn in 4 KB blocks. Same generator, ~256×
   fewer calls.

### A correctness bug found while optimising

`uuidv7` set the RFC 9562 variant bits on byte 7 (`time_hi_and_version`) rather
than byte 8 (`clock_seq_hi_and_reserved`). Every UUID this service generated was
malformed — it looked right and sorted right, and a strict parser would reject
it. Nothing caught it because the format had never been asserted. Fixed, with
`uuid.test.ts` pinning the canonical form across pool refills.

### A regression I introduced and the test caught

Making request logging conditional, an edit dropped `app.use(express.json())`
entirely — the gateway stopped parsing request bodies at all. The existing
"malformed JSON body answers 400" test caught it immediately. Restored.

---

## 2. The host

| | |
|---|---|
| CPU | 12 cores, Intel i5-1334U |
| RAM | 15 GB |
| Postgres | `max_connections` 100 (raised to 400 for the test), `shared_buffers` 128 MB, `fsync=on` |
| Shared with | gateway, Postgres, Redis, 2× Kafka, pgbouncer, **and the load generator** |

The load generator runs on the same 12 cores. A separate generator machine would
raise every number below.

---

## 2b. Measured ceilings, single gateway instance (26 September, before the §1 fixes)

Kept for comparison. The per-request costs here are the *pre-optimisation*
figures; §1 is the current measurement and supersedes them.

| Path | Ceiling | Cost per request | Binding constraint |
|---|---|---|---|
| **Read** (`GET /authority/complaints`) | ~1,000 req/s | 0.96 ms CPU | one Node process ≈ one core |
| **Write** (`POST /authority/complaints`) | ~120 writes/s | 8.3 ms CPU | one Node process ≈ one core |
| Write, single hot partition | ~75 writes/s | 10.1 ms CPU | **row-lock contention** |

Read path detail, rising offered rate:

| Offered | p50 | p95 | Gateway CPU |
|---|---|---|---|
| 200/s | 3.25 ms | 4.97 ms | 43% of one core |
| 500/s | 3.27 ms | 10.1 ms | 82% of one core |
| 1,000/s | 4.55 ms | 59.8 ms | **96% of one core — saturated** |

Write path, contention removed (200 partitions):

| Offered | Achieved | p50 | p95 | Gateway CPU |
|---|---|---|---|---|
| 300/s | **120/s** | 178 ms | 664 ms | 100% of one core |
| 600/s | 74/s | 38 ms | 336 ms | 93% of one core |

---

## 3. Wall one, now largely removed: the proximity-dedupe query serialised a district

**Status: fixed and measured, 27 September 2026.** This was the wall that made
scaling out actively *harmful*, and it was the precondition for any write-path
scaling. The original analysis is kept at the end of the section.

### The problem

`POST /authority/complaints` ran a proximity-dedupe lookup before inserting:

```sql
SELECT id, status, report_count, ... FROM complaints
WHERE district = $1 AND zone = $2
  AND lat IS NOT NULL AND lng IS NOT NULL
  AND UPPER(status) NOT IN ('RESOLVED','DISMISSED','CLOSED')
ORDER BY created_at DESC
LIMIT 25 FOR UPDATE
```

`FOR UPDATE` locked the 25 newest rows **in the district/zone**. Every concurrent
write to the same district/zone queued on the same 25 rows. Sampling
`pg_stat_activity` during a run showed every active backend waiting on a row
lock, not on CPU or disk.

The lock lived in Postgres, keyed by district/zone, so two gateway instances
routing to the same district contended on exactly the same rows. Horizontal
scaling relieved CPU and nothing else.

### The fix

Two phases. Find the merge target with an **unlocked MVCC read** — a plain
`SELECT` takes no row locks — then lock **only the row actually being merged
into**, then **re-verify under that lock**:

```ts
// 1. Unlocked scan: no row locks, so writers in one partition do not serialise.
const candidates = await tx`SELECT ... ORDER BY created_at DESC LIMIT 25`;  // no FOR UPDATE
const near = candidates.find(withinMergeRadius);

// 2. Lock exactly one row.
const locked = await tx`SELECT ... WHERE id = ${near.id} FOR UPDATE`;

// 3. Re-verify: READ COMMITTED gives each statement a fresh snapshot, so this
//    sees a concurrent resolve or delete that landed during the scan.
if (!row || !withinMergeRadius(row) || !isMergeable(row)) continue;  // rescan
```

Locked set per write: **25 rows → 1**.

Correctness rests on the re-verification, not on the scan. A candidate can be
resolved or removed between the scan and the lock, and merging into it would
corrupt `report_count`. The scan is retried up to three times; exhaustion returns
a retryable 503 rather than splitting a report that should have been merged, and
the idempotency claim is released so the retry is an ordinary request.

One subtlety that caused a real bug during the change: "no candidate within the
radius" is the *ordinary* path to a new row, not contention. An early version
conflated the two and answered 503 for every write outside the radius in a busy
partition — 1800 of 4792 requests. The retry path is now gated on a
candidate-actually-went-stale flag.

### Measured, controlled A/B

Identical hardware, identical settings (concurrency 24, inflight 20, 20s), only
the dedupe implementation changed. Figures are for **accepted** (2xx) requests
only: a 429 is answered in under a millisecond, so including rejections makes a
saturated system look faster than an unloaded one.

| | accepted/s | accepted p50 | accepted p99 |
|---|---|---|---|
| **Before**, hot partition | 73.8 | 213.6 ms | 376.2 ms |
| **Before**, spread over 40 | 282.5 | 56.7 ms | 130.8 ms |
| **After**, hot partition | **180.3** | **90.6 ms** | **171.0 ms** |
| **After**, spread over 40 | 264.8 | 59.8 ms | 153.2 ms |

On the hot partition: **2.44x more accepted writes**, p50 -58%, p99 -55%. The
hot/spread penalty narrowed from **3.77x to 1.52x** on p50. Spread is unchanged
within noise, so this is specifically the removal of partition serialisation.

At concurrency 24 with the inflight cap mis-set to 200 (above the pool of 20) the
effect was starker still: p50 **8315 ms -> 102 ms**, and the 500s a mis-set cap
causes are now a retryable 503 rather than a hard failure.

### What remains

The hot partition is still 1.52x worse than spread, and that residue is
**inherent**: when many reports are genuinely within 100 m of each other they all
merge into one row, and a single-row update serialises by definition. Options for
the remainder, in order of preference:

1. **Stop denormalising `report_count`** — store one row per citizen report and
   derive the count. Removes the read-modify-write entirely. A schema change.
2. **Geohash-bucket the dedupe key** so the candidate set is naturally narrow.
3. **Advisory lock per partition** (`pg_advisory_xact_lock`) — predictable, but
   still one writer per district at a time, so it caps rather than scales.

### A separate inefficiency in the same query

The predicate is `UPPER(status) NOT IN (...)`, and the wrapping function makes it
unservable from the index, so it stays a heap check:

```sql
CREATE INDEX complaints_open_dedupe_idx
  ON complaints (district, zone, created_at DESC)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
```

A functional index on the same predicate — adding
`AND UPPER(status) NOT IN (...)` to the partial `WHERE` — would let the lookup be
index-driven, or better, making status values canonical on write would let
`UPPER()` be dropped entirely. Not done: it is a schema migration that has to be
applied to the managed database, and it wants a measurement against
production-shaped data first.

### The original finding, for reference

Proof by isolation, before the fix, k6:

| | Hot partition (`PUN/Z1`) | Spread over 200 partitions |
|---|---|---|
| p50 latency | 794 ms | **55.6 ms** (14x better) |
| p95 latency | 1.07 s | 475 ms |
| Writes completed | 3,161 | **5,272** (+67%) |
| CPU per write | 10.1 ms | 7.25 ms (-28%) |

This was not hypothetical. A district/zone is the natural partition for this
system, and a city-wide outage — precisely when a road-maintenance complaint
platform gets its heaviest traffic — puts every report into one partition.
## 4. Wall two: one Node process is about one core

Once contention is removed, writes cost **4.8 ms of CPU each** as measured in §1 and the gateway
saturates at one core for ~120 writes/s. Reads cost 0.96 ms and saturate at
~1,000 req/s.

Extrapolating from the current per-request costs in §1:

| Target | App CPU required | ~12-core hosts |
|---|---|---|
| 10,000 **reads**/s | 15 cores | **~2** |
| 100,000 **reads**/s | 96 cores | **~8** |
| 10,000 **writes**/s | 48 cores | **~4** |
| 100,000 **writes**/s | 830 cores | **~69** |

So:

- **Read TPS is reachable** by running instances behind a load balancer, with the
  database sized for the aggregate connection count (`instances × PGPOOL_MAX`,
  against `max_connections`). Reads have no shared serialisation point, so this
  scales linearly. At 1.5–1.9 ms per read, 100k/s is ~96 cores.
- **100k write TPS needs ~830 cores of application CPU** on the current request
  shape, *and* a Postgres that scales writes, which one node does not. That is a
  different system, not a configuration change.

Per-instance connection budget matters as much as instance count: at
`PGPOOL_MAX=90` and 10 instances that is 900 connections, so
`max_connections` and the provider limit must be raised deliberately or pgbouncer
put back in the path.

### Levers that would change the write number

Ordered by effect per unit of effort:

1. **Fix the dedupe locking** (§3). Necessary for scaling out at all.
2. **Cut per-write cost.** A write currently issues roughly 14 statements: two
   admission permits, an idempotency claim and completion, and inside the
   transaction a dedupe read, complaint write, outbox write, SLA read and write,
   notification write, inbox write, preferences read and delivery writes. Moving
   notifications to an outbox row drained by the relay — the pattern already used
   for Kafka events — would remove most of that from the request path. **Note the
   trade-off:** notifications were moved *into* the transaction to fix a real
   `report_count` corruption, so this must be done by outboxing them, not by
   moving them back out.
3. **Multiple gateway processes per host** (`cluster`), so one host is not
   limited to one core of JS.
4. **A faster runtime** for the hot path if the target is genuinely 100k/s.
   Node is not the wrong choice at 1,000 req/s; at 100k it is a meaningful tax,
   and `JSON.stringify` alone measured 121 µs for a 20-row page.
5. **Stop parsing timestamps into `Date` objects on the read path.**
   `postgres-date` was 4.0% of read CPU and 20 `Date` objects per page are
   constructed only to be re-serialized to strings. Not done here because
   `rtiDeadlines.ts` calls `.getTime()` on a raw row value, so the change is a
   real audit rather than a one-liner. Measured and documented instead of
   skipped silently.

---

## 5. What the disk is *not* costing

`fsync=off` and `synchronous_commit=off` were tested as an A/B. Result:
3,670 successful writes versus 3,300, and median latency 395 ms versus 545 ms.

**Disk durability is not the bottleneck on this hardware** — the difference is
within noise. That also means there is no cheap win available by weakening
durability, and the settings were restored to `fsync=on`
(`synchronous_commit=on`) immediately after measuring.

---

## 6. Two findings from this exercise that are not about throughput

### Two read endpoints were returning 500 for every request

`GET /authority/complaints` and the complaint-history endpoint were completely
broken, independent of load. Their WHERE clauses were composed as:

```ts
let districtCondition = pool``;                        // executes; returns rows
if (query.district) districtCondition = pool`AND district = ${query.district}`;
```

`pool` **executes** and returns rows, so `districtCondition` held a `Promise`,
not a SQL fragment. Interpolating a Promise into the outer template failed the
fragment check, so the condition was never spliced into the SQL while the
parameter list advanced past a placeholder that no longer existed. Postgres
rejected it: `syntax error at or near "$1"`.

The test suite missed it because no test exercised a composed WHERE clause — it
only covered `/health` and a 404. Fixed with a `sqlFragment` helper that returns
the fragment shape the executor understands, plus four regression tests
including the decisive one: *`sqlFragment` must not return a Promise*.

Verified after the fix, against real data:

```
CE sees (3 districts)   : 3 rows
district=MUM            : 1 row   -> MUM
district=PNQ&zone=Z3    : 1 row
```

All four cases returned 500 before.

### Overload kills the process instead of shedding load

At 1,000 read req/s the gateway exhausted its connection pool and died:

```
[gateway-api] unhandled promise rejection (100/100): Error: timeout exceeded when trying to connect
[gateway-api] too many unhandled rejections — exiting so the orchestrator can restart cleanly.
```

The process guard behaved exactly as designed. But the shape is wrong for a
peak-traffic event: once the pool is exhausted *every* request fails, so 100
rejections accumulate in about two seconds and the process exits. The admission
limiter covers the write path only — **the read path has no admission control**,
which is how an unbounded read load reaches the pool in the first place.

Fix: extend admission control to reads, or give the read path a bounded queue so
overload becomes latency and a 503 rather than a restart.

---

## 6a. Read overload: the fix, and a correction

The read path had no admission control, which is how an unbounded read load
reached the connection pool: at ~1,000 read req/s the pool was exhausted, every
request failed with `timeout exceeded when trying to connect`, 100 unhandled
rejections accumulated in about two seconds and the process exited. A restart is
the worst possible response to a traffic spike.

Three things turned out to matter, in this order.

**The process death is already fixed without a limiter.** That failure was
unhandled *rejections* from acquire timeouts. They are now answered with a
handled, retryable 503 carrying `Retry-After`, so there is nothing left to go
unhandled. Verified at concurrency 64, 128 and 256 with no read limiter at all:
0 crashes, 0 transport errors, and the pool was never exhausted at any of them.

**The authority list had no read cache.** The citizen list in
`routes/complaints.ts` has had one since it was written; the authority list —
the endpoint every measurement here uses — did not, so each request spent a
database connection to return rows identical to every other caller asking the
same question. Measured after adding it: **5,223 accepted req/s at p50 10.2 ms**
at concurrency 64, against 2,838 before.

**A read limiter was implemented, measured, and made opt-in.** It works, and it
costs more than it saves here:

| | accepted req/s | p50 |
|---|---|---|
| default (no read limiter) | **5,223** | 10.2 ms |
| `READ_ADMISSION=on`, cap 160 | 1,868 | 31.7 ms |
| `READ_ADMISSION=on`, cap 20 (= pool) | 1,447 | 22.1 ms |

Two mistakes worth recording, because both looked correct:

1. *Sizing the cap at the pool size* was wrong, and measurably so. It assumes
   every read holds a connection; once the cache is in front, most do not. The cap
   was throttling requests that cost nothing, and cost 49% of throughput while
   protecting nothing.
2. *Deriving a rate ceiling from the inflight cap* — pool x 60 = 1200/min — made
   the rate check bind before the concurrency one. At 5,694 req/s offered, every
   request after the first 1200 in the window was refused and **none** were served.
   A rate ceiling nobody asked for is worse than none, because it is invisible: it
   looks like concurrency protection.

So `READ_ADMISSION` is off by default and the read path is protected by the things
that cost nothing when unused — the cache, pagination, and the retryable 503. The
limiter remains available for a deployment that has nowhere else to shed load,
such as one whose load balancer does not rate-limit.

The cache key is the other thing that had to be right. The list is filtered by the
caller's district scope, so a key that omitted the scope would serve one officer
another's rows — a data leak, not just a stale read. `authority-list-cache.test.ts`
covers the scope, pagination and filter dimensions against a real Redis, including
the case where a district-wide officer must not receive a single-district
officer's entry.

---

## 7. Recommended next step

1. **Stop parsing timestamps into `Date` objects** on the read path (§4, item 5).
   Measured at 4.0% of read CPU; needs an audit of `.getTime()` call sites. The
   largest single remaining item on the read path.
2. **Make the dedupe status filter indexable** (§3) — a functional index on the
   partial predicate, or canonical status values so `UPPER()` can go. A schema
   migration, so it wants a production-shaped measurement first.
3. **Put a CDN or edge cache in front of the read path.** At the measured
   5,223 req/s the gateway is the cheapest thing in the request path; a read that
   never reaches it costs nothing here. This is the single largest lever left for
   the 100k read target, and it is deployment rather than code.
4. **Decide the target shape.** 100k reads/s is a horizontal-scaling exercise.
   100k writes/s is a re-architecture: sharded Postgres, an asynchronous write
   path, and a faster runtime on the hot path.

The honest summary: **per-request cost is now 1.5–1.9 ms for a read and 4.8 ms
for a write, down from 10.7 ms and 9.3 ms.** On this host, one gateway instance
does roughly 750–1,070 reads/s, and about 170 accepted writes/s on a single hot
district against 265 spread over 40. Both remain CPU-bound on a single Node
process. The write path no longer serialises per district beyond what a
single-row merge genuinely requires.

---

## 8. Re-measurement, 28 September 2026

Measured on the same host as §1–§7, but on a **populated** database rather than a
near-empty one, and with the read cache warm. Two walls that the earlier numbers
could not see became visible.

### 8.0 Configuration, so every number below is reproducible

| Component | Setting |
|---|---|
| Host | 12 vCPU, Intel i5-1334U, ~15 GB, shared with the desktop and the load generator |
| Gateway | one Node process, `tsx src/index.ts`, `HOST=0.0.0.0`, no cluster mode |
| Postgres | local container, port 15433, `max_connections` **100**, `PGPOOL_MAX` 60 (90 in §8.5) |
| Redis | local container, port 16379, read cache on, TTL **10 s** |
| Kafka | two local clusters (HLF :9094, events :9095), outbox relay live in-process |
| Dataset | grew during the runs, as write tests added rows: **18,423** at the start of the read sweep, **61,767** by the end of the write-only sweeps, **74,820** by the end of the mixed runs; 13,383 in the hot `PUN`/`Z1` cell; 18,423 with coordinates |
| Read probe | `GET /authority/complaints?limit=20`, CE token, `districts:[ALL] zones:[ALL]`, 5 s warmup, 20 s measured |
| Write probe | `POST /authority/complaints`, `--spread-zones 0` (hot cell), 5 s warmup, 20 s measured |

These are **lower bounds**. The load generator, the gateway, Postgres, Redis, two
Kafka brokers and an interactive desktop session share the same 12 cores. Per-request
CPU is the figure that transfers to a fleet; single-instance throughput is noisy.

A note on validity, because it invalidated the first two attempts: a run is only
counted if the Postgres container ID and start time are unchanged before and after,
and `pg_isready` succeeds on both sides. An early sweep lost 15433 → 16432 mid-run
and produced ~200,000 `ECONNREFUSED` 500s; those numbers are discarded here, not
salvaged.

### 8.1 Read ceiling, cache warm: 3,866 req/s

`GET /authority/complaints?limit=20`, cache warm, 20 s per row, 0 errors throughout.

| Concurrency | Accepted req/s | p50 | p90 | p99 | Gateway CPU | CPU per request |
|---|---|---|---|---|---|---|
| 1 | 583.0 | 1.71 ms | 2.55 ms | 3.90 ms | 15.39 s | 1.320 ms |
| 2 | 1,311.7 | 1.27 ms | 2.47 ms | 4.59 ms | 21.73 s | 0.828 ms |
| 4 | 2,181.8 | 1.54 ms | 2.92 ms | 5.99 ms | 24.69 s | 0.566 ms |
| 8 | 2,361.3 | 3.19 ms | 6.02 ms | 9.63 ms | 25.23 s | 0.534 ms |
| 16 | 3,703.1 | 3.75 ms | 7.17 ms | 11.58 ms | 26.33 s | 0.355 ms |
| **32** | **3,865.5** | **7.12 ms** | 13.70 ms | 21.32 ms | 27.00 s | **0.349 ms** |
| 64 | 3,422.2 | 16.74 ms | 29.91 ms | 46.66 ms | 26.34 s | 0.385 ms |
| 128 | 3,361.1 | 34.17 ms | 58.60 ms | 96.55 ms | 26.84 s | 0.399 ms |

**Peak 3,866 req/s at concurrency 32.** Throughput *falls* beyond that while p50
doubles, which is saturation, not a plateau. Cache hit rate over the whole sweep
was **505,269 hits / 618 misses = 99.88 %**, confirmed against
`/metrics/admission` — so these are cached reads, and Postgres is not in the path
at all.

At the peak the process burns 27.0 CPU-seconds per 20 s wall = **1.35 cores** across
the main thread, V8 JIT and GC. One Node main thread is the limit, so the
transferable figure is **≈0.26 ms of main-thread CPU per cached read**
(1 core ÷ 3,866 req/s). The total-process 0.349 ms includes the outbox relay and
dispatcher ticks, which is why CPU-per-request *falls* as concurrency rises: at
concurrency 1 the same fixed background cost is divided by only 583 requests.

The 5,223 req/s in §7 is not reproducible here. Same code, larger dataset, but a
desktop and two Kafka clusters taking a larger share of 12 shared cores. The
per-request CPU is the number to carry forward, not the throughput.

### 8.2 Write ceiling: 359 req/s, and 464 req/s with a bigger pool

`POST /authority/complaints`, hot cell, `PGPOOL_MAX=60`, `COMPLAINT_WRITE_MAX_PER_MINUTE=60000`.

| Concurrency | Accepted writes/s | p50 | p99 | Status mix |
|---|---|---|---|---|
| 1 | 41.8 | 23.22 ms | 41.28 ms | 200 only |
| 2 | 72.3 | 24.38 ms | 68.08 ms | 200 only |
| 4 | 82.3 | 46.59 ms | 128.05 ms | 200 only |
| 8 | 177.9 | 42.01 ms | 99.39 ms | 200 only |
| 16 | 294.7 | 51.76 ms | 101.19 ms | 200 only |
| **32** | **359.2** | 87.77 ms | 142.26 ms | 200 only |
| 64 | 290.7 | 137.11 ms | 239.29 ms | **19,437 × 429**, 5,834 × 200 |

At concurrency 64 the 429s are the **rate limiter**, not the platform: 60,000/min
is 1,000/s, and the offered load crossed it. To separate policy from capacity the
cap was raised to 600,000/min and the sweep repeated.

| Concurrency | Accepted writes/s | p50 | p99 | 500s |
|---|---|---|---|---|
| 32 | 410.5 | 73.90 ms | 141.87 ms | 0 |
| 64 | 278.3 | 132.58 ms | **2,166 ms** | 58 |
| 128 | 70.2 | 277.18 ms | **4,354 ms** | 587 |
| 192 | 18.2 | 4,457 ms | 6,529 ms | 930 |

This is not saturation — it is a **cliff**. Throughput collapses by 95 % and the
process starts *returning 500s* while its CPU consumption *falls* (25.4 → 5.7 CPU-s),
which is the signature of requests blocked on something, not computing. The cause is
in §8.4.

### 8.3 The read cache is destroyed by any write traffic

Cache hit rate, same read probe, same code, varying only whether writes are
running:

| Load | Cache hit rate | Evidence |
|---|---|---|
| Read-only | **99.88 %** | 505,269 hits / 618 misses |
| Mixed r32 + w4 | **15.5 %** | 7,247 hits / 2,249 misses |
| Mixed r28 + w16 | 12.0 % | 4,599 hits / 2,201 misses |
| Mixed r20 + w24 | 10.8 % | 3,161 hits / 1,830 misses |
| Mixed r12 + w40 | 7.8 % | 1,429 hits / 1,407 misses |

The mechanism, measured rather than inferred. Over one 20 s mixed run:

- complaints inserted: **521**
- `rw:cache:gen` increments: **548** — 1.05 per write, so every write does
  invalidate the cache, as designed
- cache misses: **2,249** — **4.1 misses per generation bump**

`bumpComplaintReadCache()` only does `INCR` (`packages/redis/read-cache.ts:79`); it
deletes nothing. The read key embeds the generation, so a bump orphans every entry
and the next read repopulates it. With 32 read workers in flight, each bump is
observed by ~4 of them *before* any of them has repopulated the key, so all ~4 miss
and all ~4 run the full Postgres query. The 10-second TTL never matters, because
writes invalidate far more often than the TTL expires.

Confirmed in the other direction: with no client traffic at all the generation did
not move once in 15 s, so no background job is invalidating the cache. The trigger is
specifically user-visible write traffic — which, for a complaint system, means
authority staff updating statuses all day.

**The 3,866 req/s in §8.1 is only reachable if writes are rare.** It is not a
capacity number for this system; it is the number for a system nobody is writing to.

### 8.4 The write path needs two database connections per request

Every 500 in §8.2 is the same error, 2,405 occurrences in the log:

```
Error: timeout exceeded when trying to connect
    at pg-pool/index.js:45
    at async resolveAudienceUsers (apps/gateway-api/src/notifications/service.ts:349)
    at async createAndFanoutNotification (apps/gateway-api/src/notifications/service.ts:249)
    at async <anonymous> (apps/gateway-api/src/routes/authority.ts:350)
```

`POST /authority/complaints` holds a connection for its transaction, and inside that
transaction `createAndFanoutNotification` → `resolveAudienceUsers` queries the
**module-level `pool`**, not the transaction's client
(`apps/gateway-api/src/notifications/service.ts:349`). One write therefore needs two
connections at once. At `PGPOOL_MAX=60`, 60 concurrent writes consume the entire pool
and the nested query can never get a connection — it waits out the connect timeout and
the request 500s.

Controlled A/B, same workload, same rate-limit cap, only the pool size changed:

| Concurrency | `PGPOOL_MAX=60` | `PGPOOL_MAX=90` |
|---|---|---|
| 32 | 410.5/s, 0 errors | 351.2/s, 0 errors |
| 64 | 278.3/s, **58 × 500** | **463.6/s, 0 errors** |
| 128 | 70.2/s, **587 × 500** | 306.5/s, 204 × 500 |

A 33 % larger pool bought **+67 % write throughput** and cut 500s by 65 %, which
confirms the diagnosis. The ceiling is not `PGPOOL_MAX`; it is roughly
**`PGPOOL_MAX / 2` concurrent writes**, because that is how many can be in flight
before the nested audience query starves.

Moving the notification *into* the transaction was deliberate — see the comment at
`apps/gateway-api/src/routes/authority.ts:344-349`, which explains that running it
after commit produced a 500 for an already-durable complaint and double-counted
`report_count` on retry. The fix is therefore **not** to move it back out. It is to
give `resolveAudienceUsers` the transaction's client, so the audience lookup uses the
connection the request already holds. That preserves the atomicity the comment is
protecting and removes the second connection. Until then, `PGPOOL_MAX` cannot be
raised as a tuning knob without `max_connections` (100 here) rising with it, which is
a fleet-wide connection budget, not a local change.

### 8.5 Mixed load: 549 req/s, and the gateway is *not* the bottleneck

Two probe processes against one gateway, 20 s each, `PGPOOL_MAX=90`, cap 600,000/min.

| Read conc | Write conc | Total req/s | Read | Write | Gateway CPU | Hit rate | 500s |
|---|---|---|---|---|---|---|---|
| **32** | **4** | **549.0** | 523.0 | 26.0 | 0.82 cores | 18.1 % | 0 |
| 28 | 16 | 376.1 | 299.4 | 76.7 | 0.87 cores | 12.0 % | 0 |
| 20 | 24 | 308.8 | 221.9 | 86.9 | 0.89 cores | 10.8 % | 0 |
| 12 | 40 | 258.1 | 119.4 | 138.7 | 0.97 cores | 7.8 % | 0 |
| 8 | 48 | 264.0 | 95.0 | 169.0 | 1.02 cores | 7.8 % | 0 |

**549 req/s total is 7× below the read-only ceiling and worse than write-only.** The
gateway burns only **0.82–1.02 cores** across the whole table — and 3,866 reads/s
needed 1.35, so at the peak the gateway still had roughly 2.5× the headroom it uses
when saturated. It is not the constraint. With the cache invalidated by every write
(§8.3), ~90 % of reads fall through to Postgres, and the 90-connection pool becomes
the shared bottleneck for both streams. Mixed capacity is set by the database, and the
application is largely waiting for it.

The 4-connection-per-second gap is the cache: fixing §8.3 moves reads back out of
Postgres without touching the gateway's CPU budget at all.

### 8.6 What 100,000 req/s actually requires now

Using the per-request costs measured above, not the single-instance throughput.

**Cached read** — 0.259 ms main-thread CPU (§8.1): 100,000 reads/s needs **25.9 cores**,
i.e. ~26 gateway instances if reads are all there is to do. Consistent with the
linear scaling claim in §0.

**Write** — 2.727 ms total process CPU per write (§8.2, at the 463.6/s peak): 100,000
writes/s needs **273 cores**, ~23× the read cost. This is the 2.7 ms, not the old
4.80 ms — the write path is cheaper per request than §1 recorded, and still 10× a read.

**Realistic mixes**, per gateway instance, at 1 core of main-thread budget and using
0.259 ms/read and 2.727 ms/write:

| Mix | CPU per request | Per instance | Instances for 100k |
|---|---|---|---|
| 100 % read, cache warm | 0.259 ms | 3,861/s | **26** |
| 99 % / 1 % | 0.283 ms | 3,534/s | **29** |
| 95 % / 5 % | 0.382 ms | 2,617/s | **39** |
| 90 % / 10 % | 0.506 ms | 1,976/s | **51** |
| 100 % write | 2.727 ms | 367/s | **273** |

Those instance counts are only reachable **if the cache stays warm**, and §8.3
measures the hit rate collapsing to 8–18 % as soon as writes arrive. The measured
mixed figure is **549 req/s per instance**, so 100k mixed is **182 instances** as the
code stands, and fixing the invalidation is worth roughly **5×** on that axis alone.

Database side, at 5 % writes on 100k (5,000 writes/s) — this is where the next wall is,
and it is the one §0 already flagged as a re-architecture:

- Writes need **2 connections each** until §8.4 is fixed. At the 137 ms write latency
  measured at saturation, Little's law puts ~685 writes in flight → **~1,370
  connections** for writes alone, before any read misses. `max_connections` here is
  100. PgBouncer is deployed but bypassed (`POSTGRES_HOST` points at the primary).
- 5,000 writes/s into the outbox relay, i.e. 5,000 Kafka events/s sustained.
- Fabric cannot absorb that rate as a single ordering service; the Merkle batching
  path in `services/fabric-anchor-consumer` is the only thing that makes it tractable,
  and it is **not deployed** — see `STATE.md` §6.

### 8.7 What to fix, in order

1. **Stop invalidating the read cache on every write** (§8.3). Biggest single lever in
   this document: worth ~5× on mixed capacity and it costs no CPU. The generation
   scheme is right for *correctness* — a district-wide officer must never see another
   officer's rows — but it is being used as a global kill switch. Cache the payload
   and invalidate per-district or per-zone, or shorten the TTL and let writes ride it.
2. **Give `resolveAudienceUsers` the transaction's client** (§8.4). One-line class of
   fix, removes a connection per write, and takes the write cliff away. Must not
   reintroduce the post-commit notification the comment at `authority.ts:344` warns about.
3. **Only then re-tune `PGPOOL_MAX`.** It is a fleet connection budget, not a local knob.
4. **Re-measure with the cache warm *and* writes running.** Every read-only number in
   this document is unrepresentative until 1 and 2 are done, and §8.5 is the only
   figure measured under a mixed load.
5. **Keep §0's conclusion.** 100k reads is a horizontal-scaling exercise. 100k writes,
   or 100k mixed with 5 % writes, is still a re-architecture: the 1,370-connection
   write requirement and 5,000 events/s are the hard part, and neither is Node tuning.

### 8.8 What this section does not establish

- All figures are one gateway process on a 12-core laptop sharing cores with the load
  generator, two Kafka brokers and a desktop session. **Lower bounds.** No multi-instance
  or multi-host test was run, so the linear scaling in §8.6 is an inference from
  per-request CPU, not a measurement.
- Single runs of 20 s per point. Run-to-run variance on the write peak is real:
  351–410 req/s at concurrency 32 across three runs, and 464 req/s at concurrency 64
  with the larger pool. Treat the write ceiling as a **350–465 req/s band**, not a point.
- The dataset grew throughout, because write tests add rows: 18,423 → 61,767 across the
  write-only sweeps, and → 74,820 across the mixed sweeps. Index depth is therefore a
  confound **across** the tables above, and the read sweep ran against the smallest
  table of all (18,423). The §8.5 mixed figures ran against the largest, so 549 req/s
  is the conservative end of that number rather than a best case.
- `max_connections=100` on a shared Postgres that also backs the dispatcher, the outbox
  relay and the notification audience queries. The write ceiling here is partly a
  property of that limit, and a differently sized Postgres would move it.
- Fabric was not running. No Kafka consumer, dispatcher, SLA timer or Fabric anchoring
  throughput was measured; the outbox relay was publishing, and its cost is inside the
  2.727 ms per write but was not isolated.
- No p99 or error-rate target was set for the 100k case, so "accepts 100k" above means
  throughput only. The p99 at saturation is already 21 ms for cached reads and 142 ms
  for writes on this host, before any network.


## 9. The two fixes from §8.7, measured, 28 September 2026

§8.7 ranked two fixes. Both are now in the source and both have been measured as a
controlled A/B. This section records what changed, what it bought, and — the part
that matters more — **what it did not fix.**

Everything below was measured on the same host with the same harness, and every
A/B pair ran against the **same database (99,838 complaints) and the same Postgres
container** (`00995ec9463b`, started `07:22:18.548808164Z`, verified unchanged either
side of every run). The only variable toggled between arms is the code.

### 9.0 A correction to §8.1 before anything else

While re-measuring, cached reads came back at **1,100–1,700 req/s**, not 3,866, and
the cache metrics said 99.99 % hits. The first hypothesis was the dataset: it had
grown 5.4× since §8.1. That hypothesis was **tested and rejected.** On the identical
99,838-row database, the *unmodified* code also delivered 1,272 req/s at c32 and
1,331 req/s at c64. The dataset does not explain §8.1's 3,866.

The real cause is in §9.3: a diagnostic was writing to the log on every request. It
was in a capacity harness configuration, not in the default deployment, which is why
§8.1 — taken with `READ_ADMISSION` off — never saw it. **The 3,866 req/s in §8.1
should be read as a single lucky run of a noisy measurement, not as a ceiling.** The
spread on this host is ±25 % (below), which is wide enough to swallow a 3× claim
unless runs are repeated. Repeat counts are the methodological change from §8.

### 9.1 Run-to-run variance, measured rather than assumed

Four consecutive c64 read runs, same code, same data, alternating arms:

| Arm | Runs (req/s @ c64) | Mean | CPU per request |
|---|---|---|---|
| Baseline (no single-flight) | 3,650 / 2,881 / 4,011 | 3,514 | 0.352 / 0.414 / 0.306 ms |
| F10 single-flight | 2,730 / 3,520 / 2,864 / 4,131 | 3,311 | 0.762 / 0.350 / 0.417 / 0.304 ms |

**The two arms are indistinguishable on read-only load.** F10 does nothing for
read-only throughput, and claiming otherwise from a single run would have been wrong:
one early pair of single runs read 1,331 vs 2,730 and looked like a 2× win, which
three more runs of each arm demolished.

This is the expected result, not a disappointment. §8.3's mechanism is a *generation
bump*, and read-only load produces no writes, so there is nothing to collapse. F10 can
only show up under concurrent writes, which is §9.2.

### 9.2 F10 — single-flight fill: 2.2× on mixed load, and the stampede is 4.7× smaller

Mixed load, r64 + w8, 30 s, three runs per arm, same database and container.

| | Baseline | F10 single-flight |
|---|---|---|
| Total accepted | 533.7 / 586.8 / 673.8 req/s | **1,115.0 / 1,255.8 / 1,309.4 req/s** |
| Read | 515.6 / 569.6 / 659.8 req/s | 1,044.5 / 1,190.9 / 1,230.5 req/s |
| Write | 14.0 / 17.2 / 18.1 req/s | **64.9 / 70.5 / 78.9 req/s** |
| Write p50 | 438.96 / 458.96 / 577.43 ms | **88.26 / 104.42 / 105.82 ms** |
| Cache hit rate | 14.3 % / 15.4 % / 16.2 % | **61.2 % / 65.3 % / 62.0 %** |
| Cache misses per run | 3,085 / 3,135 / 3,421 | **633 / 661 / 755** |
| Write 500s | 0 | 0 |

**Mixed throughput 1.9–2.3×, and every arm beat every baseline arm** — which is what
distinguishes this from §9.1. The cache miss count falls 4.7×, consistent with §8.3's
"4.1 misses per generation bump" collapsing to roughly one fill per bump, and write
p50 falls 4.5× because the read stream stops competing with the write stream for the
90-connection pool.

Write throughput itself rises 4.4×, which is a second-order effect worth stating
plainly: collapsing the read stampede returns connections to the pool that the
stampede had been holding, so the writes get them. The write path did not get cheaper.

The freshness contract is unchanged. The key still embeds the generation, so a read
issued *after* a write still misses and refills; waiters only share a fill that was
already in progress when they arrived, which is the same race a cache read already had
against a concurrent write, now one fill wide instead of one response wide.

Coverage: `apps/gateway-api/src/authority-list-cache.test.ts` — 24 concurrent misses
produce one origin fill, distinct scopes do not share a fill, a leader that throws does
not fail its waiters, a read after a generation bump refills, and 32 readers across a
bump cause one fill.

### 9.3 A per-request `console.warn` that cost 4 % of the gateway and corrupted a measurement

`warnOnPoolMismatch` (`apps/gateway-api/src/security/write-backpressure.ts:45`) warns
when an inflight cap exceeds `PGPOOL_MAX`. That is a statement about *configuration*,
but it was called from inside the per-request admission path — twice, via
`acquireReadAdmission` and `boundsFromEnv`. At a deliberate inflight-above-pool setting
it fired on every request: **13 MB of identical warnings** in one sweep, and
`consoleCall` was **3.93 %** of a CPU profile, with the log writes adding to
`writeUtf8String`.

Two consequences, and the second is the reason this belongs in a capacity document:

1. A real but modest cost, ~4 % of one process.
2. **It silently invalidated a measurement.** The run it was captured in reported
   1,100–1,700 req/s at a 99.99 % cache hit rate, and the first reading of that was
   "the read path regressed 3×". The warning was writing 13 MB to a file that the
   gateway and the load generator were then measured against. A harness-induced
   configuration mismatch was being booked as a capacity regression.

Fixed by warning once per distinct configuration
(`apps/gateway-api/src/security/write-backpressure.ts:76`), covered by
`apps/gateway-api/src/write-backpressure.test.ts`.

**The generalisable lesson, and it is a process failure as much as a code one:** the
CPU profile was the thing that found it, and only because it was taken. A throughput
number alone would have sent this straight into a capacity report as a regression, and
§9.0's "the dataset is bigger" guess was wrong. Profiling a surprising result is not
optional, and neither is repeating a run before believing it.

### 9.4 F11 — the transaction client: the write cliff is gone, and 498 req/s at pool 60

§8.4 identified that `resolveAudienceUsers` used the module-level `pool` while the
complaint transaction held a second connection, so one write needed two connections at
once and concurrent writes starved at roughly `PGPOOL_MAX / 2`. The fix passes the
transaction's executor through
(`apps/gateway-api/src/notifications/service.ts`, `resolveAudienceUsers(m.audience, params.tx ?? pool)`),
preserving the in-transaction atomicity that the comment at `authority.ts:344` is
protecting. The notification was **not** moved back after commit.

Writes, `PGPOOL_MAX=60`, cap 600,000/min, dataset now 99,838 (larger than §8.2's, so
this is not a like-for-like row count — §8.2's cliff rows ran against 61,767–74,820):

| Concurrency | §8.2 before fix (pool 60) | After fix (pool 60) | 500s after fix |
|---|---|---|---|
| 32 | 410.5/s | 388.8/s | 0 |
| 64 | 278.3/s, **58 × 500** | **440.2/s** | 0 |
| 128 | 70.2/s, **587 × 500** | **448.3/s** | 0 |
| 192 | 18.2/s, **930 × 500** | **498.3/s** | 0 |
| 256 | — | 330.7/s | 0 |

Zero `timeout exceeded when trying to connect` at any concurrency, against 2,405
occurrences before. The cliff is not "moved", it is gone: throughput now *rises* to
c192 where it previously collapsed by 95 %, and the p99 at the peak is 575 ms rather
than 6,529 ms. Beyond c256 it falls again, which is ordinary saturation rather than
the old pathological shape.

**The peak is 498 req/s at a pool of 60, not at a pool of 90.** That is the point of
the fix: the write ceiling was previously a function of a fleet-wide connection
budget, and it is now a function of the gateway's own CPU. `PGPOOL_MAX` is no longer
the write knob, so the 90-connection budget §8.4 warned about is no longer required
to get the write throughput.

### 9.5 What §8's numbers should be replaced with

| Quantity | §8 value | Current | Note |
|---|---|---|---|
| Cached read, read-only, c32 | 3,866 req/s | 1,272–1,555 req/s | §8.1 was a lucky run; §9.0 |
| Cached read, read-only, c64 | 3,422 req/s | 2,881–4,131 req/s | ±25 % band, §9.1 |
| Cached read, main-thread CPU/req | 0.259 ms | 0.26–0.45 ms | unchanged to within noise |
| Write peak, pool 60 | 359–410 req/s + a 500 cliff | **498 req/s, no cliff** | §9.4, larger dataset |
| Write concurrency for the cliff | fails above ~30 | none to c192 | §9.4 |
| Mixed total, r64+w8 | not measured | **1,115–1,309 req/s** | §9.2 |
| Mixed hit rate | 7.8–16.2 % | **61.2–65.3 %** | §9.2 |
| Misses per generation bump | 4.1 | ≈1 | §9.2 |
| Write 500s under load | 2,405 | 0 | §9.4 |

### 9.6 What is still true, and what is still open

Unchanged by this work:

- **One Node process is still about one core** (§4). The gateway used 1.2 of 12 cores
  in these runs; it is not CPU-starved on the host, it is limited by its own single
  main thread. F10 and F11 do not change this and cluster mode is still absent.
- **The read path still pays Redis per read** — a `GET` on the generation and a `GET`
  on the key, on every cached read. `writeUtf8String` at 8.75 % of the profile is
  ioredis, not HTTP. Collapsing that to one round-trip, or pipelining it, is
  unmeasured.
- **Every write still invalidates every cached list.** F10 removed the *stampede*,
  not the *invalidation*. A read after a write still misses. §8.7's first item is
  therefore only partly done: the cost per bump fell ~4.7×, but the hit rate is still
  61–65 % under writes rather than the 99.88 % of read-only load. Per-district or
  per-zone keys remain the real fix.
- **The outbox relay runs in-process** and its cost is inside every write figure here,
  unisolated. The relay was also a confound in an early read sweep: reads measured
  while `kafka_event_outbox` still had `PENDING` rows came in at 1,072–1,425 req/s and
  were discarded. The A/B in §9.1–§9.2 ran with the backlog at zero, confirmed by
  query on both sides.
- **Fabric was not running.** No anchoring, dispatcher or SLA-timer throughput was
  measured, before or after.

Now open, in the order the new evidence suggests:

1. Per-district / per-zone cache keys, to remove the remaining global invalidation.
   The measured 61–65 % hit rate under writes is the remaining headroom.
2. One Redis round-trip per cached read instead of two.
3. Cluster mode, or N gateway processes. Every number here is one process, and the
   linear scaling in §8.6 remains an inference from per-request CPU, not a
   measurement — nothing in this section changes that.
4. The 100k arithmetic in §8.6 is unchanged in shape and slightly better in
   substance: the mixed figure is no longer 549 req/s per instance but ~1,200, and
   writes no longer need 2 connections each. It is still true that 100k *writes*, or
   100k mixed at 5 % writes, is a re-architecture rather than a tuning exercise.
