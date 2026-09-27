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

## 1. The host

| | |
|---|---|
| CPU | 12 cores, Intel i5-1334U |
| RAM | 15 GB |
| Postgres | `max_connections` 100 (raised to 400 for the test), `shared_buffers` 128 MB, `fsync=on` |
| Shared with | gateway, Postgres, Redis, 2× Kafka, pgbouncer, **and the load generator** |

The load generator runs on the same 12 cores, and it alone consumed more CPU
than the entire data plane in the optimisation run. A separate generator
machine would raise every number below.

---

## 2a. Measured ceilings, single gateway instance (26 September, before §1)

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

## 3. Wall one, still open: the proximity-dedupe query serialises a district

This is the more important finding, because **adding gateway instances makes it
worse rather than better.**

`POST /authority/complaints` runs a proximity-dedupe lookup before inserting:

```sql
SELECT id, status, report_count, ... FROM complaints
WHERE district = $1 AND zone = $2
  AND lat IS NOT NULL AND lng IS NOT NULL
  AND UPPER(status) NOT IN ('RESOLVED','DISMISSED','CLOSED')
ORDER BY created_at DESC
LIMIT 25 FOR UPDATE
```

`FOR UPDATE` locks the 25 newest rows **in that district/zone**. Every concurrent
write to the same district/zone therefore queues on the same 25 rows. Sampling
`pg_stat_activity` during a run:

```
Lock / transactionid :: SELECT id, status, report_count, created_at ... FROM
Lock / tuple         :: SELECT id, status, report_count, created_at ... FROM
```

Every active backend was waiting on a row lock, not on CPU or disk.

**Proof by isolation.** Identical hardware, identical request shape, identical
offered rate — only the number of district/zone partitions differs:

| | Hot partition (`PUN/Z1`) | Spread over 200 partitions |
|---|---|---|
| p50 latency | 794 ms | **55.6 ms** (14× better) |
| p95 latency | 1.07 s | 475 ms |
| Writes completed | 3,161 | **5,272** (+67%) |
| CPU per write | 10.1 ms | 7.25 ms (−28%) |

This is not hypothetical contention. A district/zone is the natural partition
for this system, and a city-wide outage — precisely when a road-maintenance
complaint platform gets its heaviest traffic — puts every report into one
partition.

### Why scaling out does not help

The lock is held in Postgres, keyed by district/zone. Two gateway instances
routing to the same district contend on the same rows. Horizontal scaling
relieves CPU, not this.

### Options, in order of preference

1. **Lock only the row you will actually merge.** Read the candidates without a
   lock, find the match, then `SELECT ... WHERE id = $match FOR UPDATE` and
   re-verify. Reduces the locked set from 25 rows to 1. Smallest change, keeps
   the correctness property.
2. **Geohash-bucket the dedupe key** so the candidate set is naturally narrow and
   different locations never touch the same rows.
3. **Stop denormalising `report_count`.** Store one row per citizen report and
   derive the count, removing the read-modify-write entirely. Cleanest, and a
   schema change.
4. **Advisory lock per partition** (`pg_advisory_xact_lock`) — predictable, but
   still one writer per district at a time, so it caps rather than scales.

Option 1 is the one to try first; it is a contained change to a single query.

---

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

## 7. Recommended next step

1. **Fix the dedupe locking** (§3, option 1) — still the precondition for any
   write-path scaling, and still not done. It is the one wall that makes scaling
   out actively *worse* rather than neutral.
2. **Add read admission control.** The read path still has none, so read overload
   exhausts the pool and kills the process instead of shedding load. This is a
   correctness issue before it is a throughput one.
3. **Stop parsing timestamps into `Date` objects** on the read path (§4, item 5).
   Measured at 4.0% of read CPU; needs an audit of `.getTime()` call sites.
4. **Decide the target shape.** 100k reads/s is a horizontal-scaling exercise.
   100k writes/s is a re-architecture: sharded Postgres, an asynchronous write
   path, and a faster runtime on the hot path.

The honest summary: **per-request cost is now 1.5–1.9 ms for a read and 4.8 ms
for a write, down from 10.7 ms and 9.3 ms.** On this host, one gateway instance
does roughly 750–1,070 reads/s or 245 writes/s, and both remain CPU-bound on a
single Node process. Writes are additionally serialised per district by the
unfixed dedupe lock.
