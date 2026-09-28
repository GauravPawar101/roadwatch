#!/usr/bin/env bash
# Runs the gateway under the V8 CPU profiler against the on-device stack, drives
# load at it, stops it, and reports the CPU it actually used.
#
# Two details that are easy to get wrong and that this script had to fix:
#
#  * `tsx src/index.ts` swallows `--cpu-prof`; the flags go to tsx, not to the
#    node process it wraps, and no profile is written. `node --import tsx` passes
#    them to node, so the profile is the real one.
#  * CPU is read from /proc/<pid>/stat, and the comm field is parenthesised and
#    can itself contain spaces, so field 14 is not utime by index. The line is
#    split after the final ')'. The wrapper also spawns a child, so the tree is
#    summed rather than a single pid.
#
# Usage:
#   MODE=read CONCURRENCY=16 SECONDS=30 ops/profile/run.sh
#   MODE=write CONCURRENCY=8 SECONDS=30 ops/profile/run.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

MODE="${MODE:-read}"
CONCURRENCY="${CONCURRENCY:-16}"
RUN_SECONDS="${SECONDS:-30}"
PORT="${PORT:-3100}"

SECRET="${ACCESS_SECRET:-}"
if [[ -z "$SECRET" ]]; then
  # A fresh random secret per run. The gateway refuses to start under
  # NODE_ENV=production with the built-in development secret, and a profiling run
  # is a production-mode run. Generating one keeps that guard intact rather than
  # weakening NODE_ENV to get past it.
  SECRET="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
fi

# Empty, not unset: dotenv refills unset keys from .env and the cloud tier has
# top precedence, so a run aimed at the on-device stack would silently target
# Aiven and Upstash. See docs/MANAGED_SERVICES.md.
export DATABASE_CLOUD_URL='' POSTGRES_CLOUD_URL=''
export REDIS_CLOUD_URL='' REDIS_MANAGED_URL=''
export UPSTASH_REDIS_REST_URL='' UPSTASH_REDIS_REST_TOKEN=''
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:15433/roadwatch'
export REDIS_URL='redis://127.0.0.1:16379/0'
export KAFKA_EVENTS_BROKERS='127.0.0.1:9095' KAFKA_HLF_BROKERS='127.0.0.1:9094'
export KAFKA_SSL=false
export ACCESS_SECRET="$SECRET" JWT_SECRET="$SECRET"
export PORT="$PORT" HOST=127.0.0.1
export NODE_ENV=production
# Request logging is opt-in (see apps/gateway-api/src/app.ts). Left off here so
# the profile measures the request path rather than the log path; set
# LOG_REQUESTS=1 to measure with it on.
export LOG_REQUESTS="${LOG_REQUESTS:-}"

# Admission limits. The configured defaults (120 writes/min) throttle the write
# path so hard that a profiling run measures the 429 rejection path rather than
# the write: the first run returned 22,047 rejections to 62 accepted writes. Left
# at their defaults unless a run overrides them.
export COMPLAINT_WRITE_MAX_PER_MINUTE="${COMPLAINT_WRITE_MAX_PER_MINUTE:-}"
export COMPLAINT_WRITE_MAX_INFLIGHT="${COMPLAINT_WRITE_MAX_INFLIGHT:-}"

# BUILT=1 profiles the compiled output instead of the tsx dev runtime. The dev
# runtime adds ESM-loader hook overhead (measured at 3.5-4.7% of CPU) that does
# not ship, so the built output is the profile whose numbers transfer.
BUILT="${BUILT:-1}"

PROFILE_DIR="profiles"
mkdir -p "$PROFILE_DIR"
STAMP="$(date +%H%M%S)"
PROFILE_NAME="gateway-$MODE-$STAMP.cpuprofile"
PROFILE="$PROFILE_DIR/$PROFILE_NAME"
LOG="$PROFILE_DIR/gateway-$MODE-$STAMP.log"
LOADOUT="$PROFILE_DIR/load-$MODE-$STAMP.txt"

# Sums utime+stime over a process and all its descendants.
# The comm field is parenthesised and may contain spaces, so the line is split
# after the final ')' and the fields after that are indexed from 3.
cpu_ticks_tree() {
  local root="$1" total=0 pid ppid ticks rest
  while read -r pid; do
    [[ -r "/proc/$pid/stat" ]] || continue
    rest="$(sed -E 's/^[0-9]+ \(.*\) //' "/proc/$pid/stat")"
    # After the comm field: state(1) ppid(2) pgrp(3) ... utime(12) stime(13)
    ticks="$(awk '{ print $12 + $13 }' <<<"$rest")"
    ppid="$(awk '{ print $2 }' <<<"$rest")"
    total=$((total + ticks))
    if [[ "$pid" != "$root" && "$ppid" == "$root" ]]; then
      total=$((total + $(cpu_ticks_tree "$pid")))
    fi
  done < <(pgrep -P "$root" 2>/dev/null; echo "$root")
  echo "$total"
}

echo "starting gateway (mode=$MODE built=$BUILT -> $PROFILE)"

# The profiled wrapper rather than the gateway directly: the gateway installs no
# signal handler, so the default disposition terminated it before --cpu-prof
# could flush and no profile was written. The wrapper drives node:inspector and
# writes the profile when signalled.
if [[ "$BUILT" -eq 1 ]]; then
  node ops/profile/profiled-dist.mts "$PROFILE" > "$LOG" 2>&1 &
else
  node --import tsx ops/profile/profiled-entry.mts "$PROFILE" > "$LOG" 2>&1 &
fi
GATEWAY_PID=$!

cleanup() {
  if kill -0 "$GATEWAY_PID" 2>/dev/null; then
    kill -INT "$GATEWAY_PID" 2>/dev/null
    for _ in $(seq 1 60); do
      kill -0 "$GATEWAY_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$GATEWAY_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

READY=0
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then READY=1; break; fi
  kill -0 "$GATEWAY_PID" 2>/dev/null || break
  sleep 0.25
done

if [[ "$READY" -ne 1 ]]; then
  echo "gateway did not become healthy. Log tail:"; tail -30 "$LOG"; exit 1
fi

# Recorded so a profile can be attributed to the right database.
echo "--- resolved endpoints ---"
grep -oE "\[gateway-api\] (Endpoints|kafka): .*" "$LOG" | head -2
echo

CPU_BEFORE=$(cpu_ticks_tree "$GATEWAY_PID")
WALL_START=$(date +%s%N)

./node_modules/.bin/tsx tools/load/probe.mts \
  --mode "$MODE" --concurrency "$CONCURRENCY" --seconds "$RUN_SECONDS" \
  --target "http://127.0.0.1:$PORT" --secret "$SECRET" \
  --spread-zones "${SPREAD_ZONES:-0}" \
  | tee "$LOADOUT"

CPU_AFTER=$(cpu_ticks_tree "$GATEWAY_PID")
WALL_END=$(date +%s%N)

# utime+stime are clock ticks, 100 per second on Linux, so this is core-seconds.
CPU_TICKS=$((CPU_AFTER - CPU_BEFORE))
{
  echo
  echo "=== gateway process CPU (tree) ==="
  echo "cpu_ticks     : $CPU_TICKS  at 100 Hz"
  awk -v t="$CPU_TICKS" -v a="$WALL_START" -v b="$WALL_END" 'BEGIN {
    cpu = t / 100; wall = (b - a) / 1e9;
    printf "cpu_seconds   : %.3f\n", cpu;
    printf "wall_seconds  : %.3f\n", wall;
    printf "cores_used    : %.2f\n", cpu / wall;
  }'
} | tee -a "$LOADOUT"

# SIGINT so the process drains and the profiler flushes.
kill -INT "$GATEWAY_PID" 2>/dev/null
for _ in $(seq 1 80); do
  kill -0 "$GATEWAY_PID" 2>/dev/null || break
  sleep 0.25
done
kill -9 "$GATEWAY_PID" 2>/dev/null
trap - EXIT

echo
if [[ -f "$PROFILE" ]]; then
  echo "profile: $PROFILE ($(du -h "$PROFILE" | cut -f1))"
  echo "analyse: npx tsx tools/profile/summarise.ts $PROFILE"
else
  echo "WARNING: no profile at $PROFILE. Log tail:"; tail -20 "$LOG"; exit 1
fi
