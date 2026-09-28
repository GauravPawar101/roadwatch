#!/usr/bin/env bash
# Verifies the gateway drains on SIGTERM, against the built output.
#
# The unit tests drive the handler with injected dependencies. This checks the
# thing that actually matters for a Kubernetes rolling deploy: that a real
# process, signalled for real, stops accepting, reports unready, finishes what it
# has, and exits 0 rather than being killed.
#
# Usage: ops/verify/shutdown-drill.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PORT="${PORT:-3199}"
SECRET="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"

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
export LOG_REQUESTS=""
# Short but long enough for a 50ms poller to observe, so the drill can assert the
# readiness flip rather than racing past it. Production default is 5000ms.
export SHUTDOWN_DRAIN_DELAY_MS="${SHUTDOWN_DRAIN_DELAY_MS:-700}"

LOG="$(mktemp)"
node apps/gateway-api/dist/index.js > "$LOG" 2>&1 &
PID=$!

cleanup() { kill -9 "$PID" 2>/dev/null; }
trap cleanup EXIT

READY=0
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then READY=1; break; fi
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.25
done

if [[ "$READY" -ne 1 ]]; then
  echo "FAIL: gateway never became healthy"; tail -25 "$LOG"; exit 1
fi
echo "PASS: healthy before signal"

# A request held open across the signal, to prove in-flight work finishes rather
# than being cut. Served slowly on purpose so the signal lands mid-request.
( curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:$PORT/authority/complaints?limit=5" \
    -H "Authorization: Bearer $(node -e '
      const c=require("node:crypto");
      const b=v=>Buffer.from(JSON.stringify(v)).toString("base64url");
      const h=b({alg:"HS256",typ:"JWT"});
      const p=b({sub:"00000000-0000-4000-8000-0000000000ff",role:"CE",districts:["ALL"],zones:["ALL"],exp:Math.floor(Date.now()/1000)+3600});
      const s=h+"."+p;
      process.stdout.write(s+"."+c.createHmac("sha256",process.env.ACCESS_SECRET).update(s).digest("base64url"));
    ')" > /tmp/opencode/shutdown-req.status 2>/dev/null ) &
REQ_PID=$!
sleep 0.15

START=$(date +%s%N)
kill -TERM "$PID"

# Readiness must flip before the process exits, or the load balancer keeps
# sending traffic to a closing instance.
UNREADY=0
for _ in $(seq 1 200); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo 000)"
  if [[ "$code" == "503" ]]; then UNREADY=1; break; fi
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.05
done

wait "$REQ_PID" 2>/dev/null
REQ_STATUS="$(cat /tmp/opencode/shutdown-req.status 2>/dev/null || echo 'none')"

EXITED=0
for _ in $(seq 1 200); do
  if ! kill -0 "$PID" 2>/dev/null; then EXITED=1; break; fi
  sleep 0.1
done
DRAIN_MS=$(( ($(date +%s%N) - START) / 1000000 ))

# Exit code: 0 for a clean drain. 143 would be an unhandled SIGTERM.
wait "$PID" 2>/dev/null
CODE=$?
trap - EXIT

echo "readiness flipped to 503 : $([[ $UNREADY -eq 1 ]] && echo yes || echo NO)"
echo "in-flight request status : $REQ_STATUS"
echo "process exited           : $([[ $EXITED -eq 1 ]] && echo yes || echo NO)"
echo "drain time               : ${DRAIN_MS}ms"
echo "exit code                : $CODE"
echo "--- shutdown log ---"
grep -E "\[shutdown\]" "$LOG" | sed 's/^/  /'

FAILED=0
[[ $UNREADY -eq 1 ]] || { echo "FAIL: readiness never reported draining"; FAILED=1; }
[[ $EXITED -eq 1 ]] || { echo "FAIL: process did not exit"; FAILED=1; }
[[ "$CODE" == "0" ]] || { echo "FAIL: exit code $CODE, expected 0"; FAILED=1; }
[[ "$REQ_STATUS" =~ ^(200|429|503)$ ]] || { echo "FAIL: in-flight request got '$REQ_STATUS'"; FAILED=1; }

if [[ $FAILED -eq 0 ]]; then
  echo
  echo "OK: drains on SIGTERM, reports unready, exits cleanly."
else
  echo
  echo "PROBLEMS found."
fi
exit $FAILED
