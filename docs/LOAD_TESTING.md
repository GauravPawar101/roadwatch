# Load and efficiency testing

How to run the checked-in k6 profile against a local stack, what the numbers
mean, and the three configuration traps that produce a run which looks like a
capacity failure but is not.

All figures below were measured on this repository on 26 September 2026, 3
minutes, ramping to 1000 VUs, on a 16 GB Linux host.

---

## Three traps that produce fake failures

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

For a capacity measurement, raise both:

```bash
export COMPLAINT_WRITE_MAX_PER_MINUTE=60000
export COMPLAINT_WRITE_MAX_INFLIGHT=400
```

Keep the defaults for anything that is meant to behave like production.

---

## Running it

```bash
# 1. Data plane
./ops/dev/compose.sh up -d postgres pgbouncer redis kafka-hlf kafka-events

# 2. Gateway, reachable from a container.
#    Use `tsx src/index.ts`, NOT `pnpm dev` — the dev script is `tsx watch`,
#    which restarts on any file change and will silently reset your load run.
HOST=0.0.0.0 \
COMPLAINT_WRITE_MAX_PER_MINUTE=60000 \
COMPLAINT_WRITE_MAX_INFLIGHT=400 \
  pnpm --filter @roadwatch/gateway-api exec tsx src/index.ts &

# 3. Confirm it is up
curl -s localhost:3100/health
# 4. Load
SECRET=$(node -e "import('./tools/load/resolve-target.mjs').then(m=>console.log(m.resolveAccessSecret()))")
podman run --rm --add-host=host.containers.internal:host-gateway \
  -e TARGET_URL="http://host.containers.internal:3100" \
  -e JWT_SECRET="$SECRET" -e ACCESS_SECRET="$SECRET" \
  -v "$PWD:/work:ro" -w /work --cpus=4 --memory=2g \
  docker.io/grafana/k6:latest run --quiet tests/load/k6/complaints.js
```

`pnpm loadtest` wraps this. The runner warns loudly rather than proceeding if it
would sign with the development default secret.

---

## Measured results

Final run, 1000 VUs, 3 minutes, limiter raised:

| Metric | Value |
|---|---|
| Throughput | **591 req/s** |
| Requests | 106,888 |
| Health checks passed | 100% |
| Complaint writes accepted | 28,887 (54%) |
| Rejected (429) | 24,557 (23%) |
| Latency p50 / p90 / p95 | 23 ms / 576 ms / 2.07 s |
| Data transferred | 43 MB in, 37 MB out |

### Resource cost

| Component | Peak CPU | Peak memory |
|---|---|---|
| Gateway process | 124.6 CPU-seconds total | 384 MB median (408 MB peak) |
| Gateway per request | **2.33 ms CPU** | — |
| Postgres (managed stand-in) | 26.7% | 204 MB |
| Kafka — events | 12.9% | 481 MB |
| Kafka — hlf | 12.7% | 481 MB |
| Redis | 4.7% | 16 MB |
| pgbouncer | 0.7% | 6 MB |
| **Data plane total** | **~60%** | — |

The load generator itself (k6, capped at 4 CPUs) used **100.9% CPU — more than
the entire data plane combined.** The data plane was not the bottleneck; the
application and the limiter were.

### Reading the results honestly

- **p95 of 2.07 s is poor**, and the tail is the interesting number. The inflight
  cap converts queueing directly into latency: 400 permits at 2 s of service
  time is a hard ceiling near 200 writes/s.
- **54% acceptance is the limiter, not overload.** At 1000 VUs with the cap
  raised to 60,000/min, the remaining rejections come from the *inflight* cap
  and from the adaptive shrink (see below).
- **Gateway RSS grew from 252 MB to 408 MB** across the run, a 62% increase. That
  may be normal warm-up of connection pools and caches, but it did not plateau.
  A longer run would confirm whether it is a genuine leak; it is worth checking
  before running for hours.

---

## The adaptive limiter, and why raising the limit did not help

`resolveAdaptiveLimits` shrinks capacity when it sees pressure: outbox depth,
recent 429s, recent 5xx. During the first measured run it settled at:

```json
{"maxRequestsPerWindow":37500,"maxInflight":250,"pressure":2}
```

despite `COMPLAINT_WRITE_MAX_PER_MINUTE=60000`.

**The 429 counter is an input to the limiter that produces 429s.** Once
rejections start they raise the pressure score, which lowers the ceiling, which
causes more rejections. Under sustained load this ratchets to the configured
floor and cannot recover while load continues.

That is arguably intended back-off behaviour, but it makes the limiter
non-deterministic under exactly the conditions you want to measure, and the
configured maximum becomes unreachable. If you need a stable ceiling for
capacity testing, either set `COMPLAINT_WRITE_MIN_PER_MINUTE` equal to
`COMPLAINT_WRITE_MAX_PER_MINUTE` (pinning the floor to the ceiling, so there is
no span to shrink) or exclude the 429 signal from the pressure score.

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
- No soak test was run. Given the RSS growth noted above, a multi-hour run
  should be done before trusting the process in a long-lived deployment.
- Results are from a single host with the load generator co-resident. A
  distributed generator would give cleaner latency numbers.
