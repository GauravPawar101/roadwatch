#!/usr/bin/env bash
# ops/dev/stop-all.sh — Stop local RoadWatch processes and Docker Compose stack
# Usage: ./ops/dev/stop-all.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ensure_docker_group "$@"

echo "Stopping RoadWatch services..."
echo

stop_named() {
  local name="$1" pidfile="$2"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(tr -d '[:space:]' <"$pidfile" || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      kill -9 "$pid" 2>/dev/null || true
      ok "Stopped $name (PID $pid)"
    else
      warn "$name not running (stale PID ${pid:-none})"
    fi
    rm -f "$pidfile"
  else
    echo "  No PID file for $name — skipping"
  fi
}

stop_named "Frontend" .pids/frontend.pid
stop_named "Backend API" .pids/backend-api.pid
stop_named "Gateway API" .pids/gateway-api.pid
stop_named "Scheduler" .pids/scheduler.pid
stop_named "Webhook Handler" .pids/webhook-handler.pid
stop_named "Fabric Anchor Consumer" .pids/fabric-anchor-consumer.pid
stop_named "Fabric" .pids/fabric.pid

# Stop Fabric docker network if present (native Linux, not WSL)
if [[ -f fabric/network/docker/docker-compose.yaml ]]; then
  echo
  echo "Stopping Fabric docker compose (if running)..."
  (cd fabric/network && docker compose -f docker/docker-compose.yaml stop >/dev/null 2>&1) || true
fi

echo
echo "Stopping Docker Compose infrastructure..."
docker compose stop || docker-compose stop || warn "docker compose stop failed"

if [[ -d .pids ]] && [[ -z "$(ls -A .pids 2>/dev/null || true)" ]]; then
  rmdir .pids 2>/dev/null || true
fi

echo
ok "All RoadWatch services stopped."
echo "  Start again: pnpm start:all"
echo
