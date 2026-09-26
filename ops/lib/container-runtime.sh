#!/usr/bin/env bash
# container-runtime.sh — single place that decides which container CLI to use.
#
# RoadWatch targets podman by default. Docker remains supported via
# CONTAINER_RUNTIME=docker for hosts that have not migrated, but nothing should
# hardcode `docker` any more: source this and use the helpers.
#
# Usage:
#   # shellcheck source=../lib/container-runtime.sh
#   source "$REPO_ROOT/ops/lib/container-runtime.sh"
#   resolve_container_runtime          # sets CONTAINER_RUNTIME
#   rt build -t img .                  # podman/docker build
#   rt compose up -d                  # podman-compose / docker compose
#   rt info >/dev/null                 # connectivity probe
#
# Precedence: $CONTAINER_RUNTIME -> podman if on PATH -> docker if on PATH.

# Resolve the runtime into CONTAINER_RUNTIME. Safe to call repeatedly.
resolve_container_runtime() {
  if [[ -n "${CONTAINER_RUNTIME:-}" ]]; then
    return 0
  fi

  if command -v podman >/dev/null 2>&1; then
    CONTAINER_RUNTIME=podman
  elif command -v docker >/dev/null 2>&1; then
    CONTAINER_RUNTIME=docker
  else
    echo "ERROR: neither podman nor docker is on PATH." >&2
    return 1
  fi
  export CONTAINER_RUNTIME
  return 0
}

# rt <args...> — run podman/docker with the given arguments.
rt() {
  resolve_container_runtime || return 1
  "$CONTAINER_RUNTIME" "$@"
}

# rt_compose <args...> — run the compose frontend for the chosen runtime.
# podman-compose is preferred for podman; the docker compose plugin is used for
# docker, falling back to the standalone docker-compose binary.
rt_compose() {
  resolve_container_runtime || return 1

  if [[ "$CONTAINER_RUNTIME" == "podman" ]]; then
    if command -v podman-compose >/dev/null 2>&1; then
      podman-compose "$@"
      return $?
    fi
    # Podman >= 4.4 ships its own compose provider.
    if podman compose version >/dev/null 2>&1; then
      podman compose "$@"
      return $?
    fi
    echo "ERROR: podman is selected but neither podman-compose nor 'podman compose' is available." >&2
    echo "       Install one, e.g.: pipx install podman-compose" >&2
    return 1
  fi

  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

# kind uses its own provider selection rather than a CLI, so expose it here too
# so callers do not have to remember the experimental env var name.
rt_kind_env() {
  resolve_container_runtime || return 1
  if [[ "$CONTAINER_RUNTIME" == "podman" ]]; then
    echo "KIND_EXPERIMENTAL_PROVIDER=podman"
  fi
}

# True when the runtime is usable in this session (podman needs no group
# activation; docker may need `newgrp docker`, handled by ensure_docker_group).
rt_available() {
  resolve_container_runtime || return 1
  "$CONTAINER_RUNTIME" info >/dev/null 2>&1
}
