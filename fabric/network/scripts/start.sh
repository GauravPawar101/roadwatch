#!/bin/bash
# fabric/network/scripts/start.sh
# Thin wrapper that delegates to ops/deploy/fabric-start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NETWORK_DIR/../.." && pwd)"

# shellcheck source=../../../ops/dev/ensure-docker-group.sh
source "$REPO_ROOT/ops/dev/ensure-docker-group.sh"
ensure_docker_group "$@"

# Delegate to the full implementation
exec "$REPO_ROOT/ops/deploy/fabric-start.sh" "$@"
