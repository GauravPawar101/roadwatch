#!/usr/bin/env bash
# ops/dev/verify-bootstrap.sh — Validate a fresh-clone bootstrap (no full deploy)
# Usage: ./ops/dev/verify-bootstrap.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ensure_docker_group "$@"

failed=0

check() {
  local name="$1"
  shift
  echo -n "  $name ... "
  if "$@" >/dev/null 2>&1; then
    echo "${GREEN}OK${NC}"
  else
    echo "${RED}FAIL${NC}"
    failed=$((failed + 1))
  fi
}

echo "${CYAN}Bootstrap verification${NC}"

check "setup.sh (dry bootstrap)" bash "$SCRIPT_DIR/setup.sh" --skip-install --kubernetes-only
check "docker compose config" docker compose config
check "fabric network .env.example" test -f fabric/network/.env.example
check "start-all.sh is executable" test -x "$SCRIPT_DIR/start-all.sh"
check "init-messaging.sh is executable" test -x "$REPO_ROOT/scripts/init-messaging.sh"

if have_cmd kubectl; then
  check "kustomize dev overlay" kubectl kustomize k8s/overlays/dev
else
  warn "kubectl not found — skipping kustomize check"
fi

echo
if (( failed == 0 )); then
  ok "All checks passed."
  exit 0
fi
echo "${RED}$failed check(s) failed.${NC}"
exit 1
