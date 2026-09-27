# Capacity findings: can this system do 10k TPS?

**Date:** 26 September 2026, updated 27 September 2026
**Question:** 10,000 transactions per second, or larger. Since updated to a
100,000 req/s target for an AWS EKS/EC2 deployment.

**Short answer:** not on this host, and not by scaling out alone. Two
independent walls, only one of which is hardware. The 100k req/s case adds a
third wall that is not a matter of tuning at all — see §0.

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
