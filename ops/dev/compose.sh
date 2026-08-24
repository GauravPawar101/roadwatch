#!/usr/bin/env bash
# ops/dev/compose.sh — docker compose wrapper that activates docker group via newgrp
# Usage: ./ops/dev/compose.sh up -d
#        pnpm infra:up

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=ensure-docker-group.sh
source "$SCRIPT_DIR/ensure-docker-group.sh"
ensure_docker_group "$@"

if docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi
exec docker-compose "$@"
