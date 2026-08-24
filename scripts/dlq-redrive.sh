#!/usr/bin/env bash
# scripts/dlq-redrive.sh — inspect / redrive messages from dlq-events
#
# Usage:
#   ./scripts/dlq-redrive.sh list [--max N]
#   ./scripts/dlq-redrive.sh redrive --offset N [--dry-run]
#
# Env:
#   KAFKA_EVENTS_BROKERS  (default 127.0.0.1:9095)
#   DLQ_TOPIC             (default dlq-events)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ACTION="${1:-list}"
shift || true

export KAFKA_EVENTS_BROKERS="${KAFKA_EVENTS_BROKERS:-127.0.0.1:9095}"
export DLQ_TOPIC="${DLQ_TOPIC:-dlq-events}"

exec node --experimental-vm-modules ./scripts/dlq-redrive.mjs "$ACTION" "$@"
