#!/usr/bin/env bash
# ensure-docker-group.sh — Re-exec the calling script under `newgrp docker`
# when the user is in the docker group but the current session cannot use
# the Docker socket (common right after `usermod -aG docker` on Arch/Linux).
#
# Usage (near the top of a script, after set -euo pipefail):
#   SCRIPT_DIR=...
#   # shellcheck source=ensure-docker-group.sh
#   source "$SCRIPT_DIR/ensure-docker-group.sh"
#   ensure_docker_group "$@"

ensure_docker_group() {
  # Already running inside a newgrp re-exec
  if [[ -n "${ROADWATCH_DOCKER_NEWGRP:-}" ]]; then
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  # Socket already usable in this session
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  local user
  user="$(id -un)"

  if ! getent group docker >/dev/null 2>&1; then
    echo "  [warn] docker group does not exist — install Docker first" >&2
    return 1
  fi

  if ! getent group docker | grep -Eq "(^|:|,)${user}(,|$)"; then
    echo "  [warn] User '${user}' is not in the docker group." >&2
    echo "    Run: sudo usermod -aG docker ${user} && newgrp docker" >&2
    return 1
  fi

  if ! command -v newgrp >/dev/null 2>&1; then
    echo "  [warn] newgrp not found — cannot activate docker group in this session" >&2
    return 1
  fi

  # Caller script path (the script that sourced/called this helper)
  local caller="${BASH_SOURCE[1]:-}"
  if [[ -z "$caller" ]]; then
    echo "  [warn] ensure_docker_group: missing caller path" >&2
    return 1
  fi
  # Resolve to absolute path so re-exec works after cd
  if command -v realpath >/dev/null 2>&1; then
    caller="$(realpath "$caller")"
  else
    caller="$(cd "$(dirname "$caller")" && pwd)/$(basename "$caller")"
  fi

  local cwd
  cwd="$(pwd)"

  echo "  Activating docker group via newgrp docker ..."

  # Re-run the original script with docker as the active group.
  # ROADWATCH_DOCKER_NEWGRP prevents infinite re-exec loops.
  export ROADWATCH_DOCKER_NEWGRP=1
  exec newgrp docker <<EOF
export ROADWATCH_DOCKER_NEWGRP=1
cd $(printf '%q' "$cwd")
exec $(printf '%q ' "$caller" "$@")
EOF
}
