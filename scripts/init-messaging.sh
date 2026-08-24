#!/usr/bin/env bash
# scripts/init-messaging.sh — Create Kafka topics + verify Redis DBs (Linux/macOS)
# Usage: ./scripts/init-messaging.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../ops/dev/ensure-docker-group.sh
source "$REPO_ROOT/ops/dev/ensure-docker-group.sh"
ensure_docker_group "$@"

TOPOLOGY="$REPO_ROOT/config/messaging-topology.json"

if [[ ! -f "$TOPOLOGY" ]]; then
  echo "Missing messaging topology: $TOPOLOGY" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Arch: sudo pacman -S jq" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

# Current compose stack uses dual Kafka clusters.
KAFKA_CONTAINERS=()
for c in roadwatch_kafka_events roadwatch_kafka_hlf roadwatch_kafka; do
  if docker ps --format '{{.Names}}' | grep -qx "$c"; then
    KAFKA_CONTAINERS+=("$c")
  fi
done

if (( ${#KAFKA_CONTAINERS[@]} == 0 )); then
  echo "No Kafka containers running. Start infra first: docker compose up -d" >&2
  exit 1
fi

BOOTSTRAP="$(jq -r '.kafka.bootstrapServer' "$TOPOLOGY")"
# Inside the container, use the internal listener.
INTERNAL_BOOTSTRAP="${KAFKA_INTERNAL_BOOTSTRAP:-localhost:29092}"
REPLICATION="$(jq -r '.kafka.replicationFactor' "$TOPOLOGY")"

wait_for_broker() {
  local container="$1"
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if docker exec "$container" kafka-topics --bootstrap-server "$INTERNAL_BOOTSTRAP" --list >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for Kafka in $container" >&2
  return 1
}

ensure_topics() {
  local container="$1"
  echo "  Ensuring topics on $container ..."
  wait_for_broker "$container"

  local topic partitions current
  while IFS=$'\t' read -r topic partitions; do
    echo "    • $topic ($partitions partitions)"
    docker exec "$container" kafka-topics \
      --bootstrap-server "$INTERNAL_BOOTSTRAP" \
      --create \
      --if-not-exists \
      --topic "$topic" \
      --partitions "$partitions" \
      --replication-factor "$REPLICATION" >/dev/null

    current="$(
      docker exec "$container" kafka-topics \
        --bootstrap-server "$INTERNAL_BOOTSTRAP" \
        --describe \
        --topic "$topic" 2>/dev/null \
        | sed -n 's/.*PartitionCount:[[:space:]]*\([0-9][0-9]*\).*/\1/p' \
        | head -1
    )"
    if [[ -n "$current" && "$current" -lt "$partitions" ]]; then
      echo "      -> increasing partitions $current -> $partitions"
      docker exec "$container" kafka-topics \
        --bootstrap-server "$INTERNAL_BOOTSTRAP" \
        --alter \
        --topic "$topic" \
        --partitions "$partitions" >/dev/null
    fi
  done < <(jq -r '.kafka.topics[] | [.name, (.partitions|tostring)] | @tsv' "$TOPOLOGY")
}

echo "Initializing Redis and Kafka messaging infrastructure..."
echo "  Topology bootstrap hint: $BOOTSTRAP (using in-container $INTERNAL_BOOTSTRAP)"

if ! docker ps --format '{{.Names}}' | grep -qx roadwatch_redis; then
  echo "Redis container roadwatch_redis is not running" >&2
  exit 1
fi

while IFS=$'\t' read -r index purpose; do
  echo "  • Redis DB $index — $purpose"
  docker exec roadwatch_redis redis-cli -n "$index" ping >/dev/null
done < <(jq -r '.redis.databases[] | [.index, .purpose] | @tsv' "$TOPOLOGY")

for container in "${KAFKA_CONTAINERS[@]}"; do
  ensure_topics "$container"
done

echo "Redis and Kafka initialization complete"
