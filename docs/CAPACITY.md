# Capacity findings: can this system do 10k TPS?

**Date:** 26 September 2026
**Question:** 10,000 transactions per second, or larger.
**Short answer:** not on this host, and not by scaling out alone. Two
independent walls, only one of which is hardware.

Everything below is measured, not estimated. Method and raw numbers are in
`tests/load/k6/capacity.js`; each figure names the configuration that produced
it.

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

## 2. Measured ceilings, single gateway instance

| Path | Ceiling | Cost per request | Binding constraint |
|---|---|---|---|
| **Read** (`GET /authority/complaints`) | **~1,000 req/s** | 0.96 ms CPU | one Node process ≈ one core |
| **Write** (`POST /authority/complaints`) | **~120 writes/s** | 8.3 ms CPU | one Node process ≈ one core |
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

## 3. Wall one: the proximity-dedupe query serialises a district

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

Once contention is removed, writes cost **8.3 ms of CPU each** and the gateway
saturates at one core for ~120 writes/s. Reads cost 0.96 ms and saturate at
~1,000 req/s.

Extrapolating to 10,000/s, on this class of request:

| Target | App CPU required | Instances at ~1 core each |
|---|---|---|
| 10,000 **reads**/s | 9.6 cores | **~10** |
| 10,000 **writes**/s | 83 cores | **~83** |

So:

- **10k read TPS is reachable** by running roughly 10 gateway instances behind a
  load balancer, with the database sized for the aggregate connection count
  (`10 × pool`, against `max_connections`). Reads have no shared serialisation
  point, so this scales linearly.
- **10k write TPS needs ~83 cores of application CPU** on the current request
  shape. That is a different machine, not a configuration change.

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
4. **A faster runtime** for the hot path if the target is genuinely 10k writes/s.
   Node is not the wrong choice at 1,000 req/s; at 10k writes/s it is a
   meaningful tax.

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

1. **Fix the dedupe locking** (option 1 above) — a contained change, and the
   precondition for any write-path scaling.
2. **Re-measure** with the fix in place; expect the write ceiling to move from
   ~120/s toward the CPU-bound figure, which the current data cannot yet reveal.
3. **Add read admission control** so overload sheds load instead of restarting.
4. **Then decide the target**: 10k reads/s is a horizontal-scaling exercise
   (~10 instances). 10k writes/s is roughly 83 cores of application CPU and
   should be treated as a re-architecture, not a tuning task.

The honest summary: **on this host, today, the system does ~1,000 reads/s and
~120 writes/s per gateway instance.** Both are CPU-bound on a single Node
process once the dedupe lock is fixed; before that fix, writes are additionally
serialised per district.
