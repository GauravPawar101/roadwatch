#!/usr/bin/env bash
# Shared helpers for RoadWatch Linux/macOS ops scripts.
# shellcheck disable=SC2034

set -euo pipefail

OPS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$OPS_LIB_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=ensure-docker-group.sh
source "$OPS_LIB_DIR/ensure-docker-group.sh"

CYAN=$'\033[0;36m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[0;31m'
GRAY=$'\033[0;90m'
NC=$'\033[0m'

step() {
  echo
  echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "${CYAN}  $*${NC}"
  echo "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

ok()   { echo "${GREEN}  [ok] $*${NC}"; }
warn() { echo "${YELLOW}  [warn] $*${NC}"; }
fail() { echo "${RED}  [fail] $*${NC}" >&2; exit 1; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

assert_cmd() {
  local name="$1" hint="${2:-}"
  if have_cmd "$name"; then
    ok "$name found"
    return 0
  fi
  warn "$name not found${hint:+ — $hint}"
  return 1
}

docker_ready() {
  docker info >/dev/null 2>&1
}

copy_env() {
  local example="$1" target="$2"
  if [[ ! -f "$example" ]]; then
    warn "Example missing: $example"
    return 0
  fi
  if [[ -f "$target" ]]; then
    ok "$target exists — skipping"
  else
    cp "$example" "$target"
    ok "Created $target"
  fi
}

wait_for_http() {
  local url="$1" timeout_seconds="${2:-90}"
  local deadline=$((SECONDS + timeout_seconds))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      fail "Timed out waiting for $url"
    fi
    sleep 1
  done
}

wait_for_tcp() {
  local timeout_seconds="${1:-120}"
  shift
  local deadline=$((SECONDS + timeout_seconds))
  local port
  while (( SECONDS < deadline )); do
    local all_open=1
    for port in "$@"; do
      if ! (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
        all_open=0
        break
      fi
    done
    if (( all_open == 1 )); then
      return 0
    fi
    sleep 2
  done
  fail "Timed out waiting for TCP ports: $*"
}

port_in_use() {
  local port="$1"
  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

stop_pidfile() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] || return 0
  local pid
  pid="$(tr -d '[:space:]' < "$pidfile" || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.3
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

start_bg() {
  local title="$1" pidfile="$2" logfile="$3"
  shift 3
  mkdir -p "$(dirname "$pidfile")" "$(dirname "$logfile")"
  echo "${GRAY}  → $title${NC}"
  nohup "$@" >"$logfile" 2>&1 &
  echo $! >"$pidfile"
  ok "$title (PID $(cat "$pidfile"))"
}

detect_pkg_hint() {
  if have_cmd pacman; then
    echo "sudo pacman -S --needed <pkg>"
  elif have_cmd apt-get; then
    echo "sudo apt install <pkg>"
  elif have_cmd dnf; then
    echo "sudo dnf install <pkg>"
  else
    echo "install via your package manager"
  fi
}
