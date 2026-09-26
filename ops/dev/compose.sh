#!/usr/bin/env bash
# ops/dev/compose.sh — compose wrapper for the configured container runtime.
#
# Podman is the default (see ops/lib/container-runtime.sh); set
# CONTAINER_RUNTIME=docker to use the Docker CLI instead.
#
# Usage: ./ops/dev/compose.sh up -d
#        pnpm infra:up

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=../lib/container-runtime.sh
source "$REPO_ROOT/ops/lib/container-runtime.sh"
resolve_container_runtime

# Only Docker needs a group activated for socket access; podman does not.
if [[ "$CONTAINER_RUNTIME" == "docker" ]]; then
  # shellcheck source=ensure-docker-group.sh
  source "$SCRIPT_DIR/ensure-docker-group.sh"
  ensure_docker_group "$@"
fi

# Call, do not `exec`: rt_compose is a shell function, and `exec` can only
# replace the current process with an external binary. `exec rt_compose "$@"`
# therefore failed with "rt_compose: not found" on every invocation, so
# `pnpm infra:up` never started anything.
rt_compose "$@"
