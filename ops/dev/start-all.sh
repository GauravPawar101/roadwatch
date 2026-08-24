#!/usr/bin/env bash
# ops/dev/start-all.sh — One command to set up and run RoadWatch on Linux/macOS
#
# Usage:
#   ./ops/dev/start-all.sh
#   ./ops/dev/start-all.sh --skip-fabric
#   ./ops/dev/start-all.sh --skip-seed
#   ./ops/dev/start-all.sh --skip-setup
#   ./ops/dev/start-all.sh --reset-db
#   ./ops/dev/start-all.sh --kubernetes
#   ./ops/dev/start-all.sh --kubernetes --reset --skip-build
#   pnpm start:all
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
ORIGINAL_ARGS=("$@")
USE_KUBERNETES=0
SKIP_FABRIC=0
SKIP_SEED=0
SKIP_SETUP=0
RESET_DB=0
PKG_HINT="$(detect_pkg_hint)"
# Flags to forward as-is to ops/deploy/deploy-kind.sh when --kubernetes is used.
KIND_DEPLOY_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
    --kubernetes | -Kubernetes) USE_KUBERNETES=1 ;;
    --skip-fabric | -SkipFabric) SKIP_FABRIC=1 ;;
    --skip-seed | -SkipSeed) SKIP_SEED=1 ;;
    --skip-setup | -SkipSetup) SKIP_SETUP=1 ;;
    --reset-db | -ResetDb) RESET_DB=1 ;;
    # deploy-kind.sh flags — collected and passed through only when --kubernetes is set.
    --reset | --skip-build | --skip-fabric-certs | --infra-only | --skip-app-images | --no-wait)
        KIND_DEPLOY_ARGS+=("$1")
        ;;
    --environment)
        [[ -n "${2:-}" ]] || fail "--environment requires a value"
        KIND_DEPLOY_ARGS+=("$1" "$2")
        shift
        ;;
    -h | --help)
        cat <<'EOF'
Usage: start-all.sh [options]
  --kubernetes         Deploy via kind (requires docker + kind + kubectl)
  --skip-fabric        Skip Hyperledger Fabric network
  --skip-seed          Skip pnpm seed:demo
  --skip-setup         Skip bootstrap (deps / .env)
  --reset-db           Drop the postgres_data volume so docker/postgres/init.sql
                        re-runs on next boot (Postgres only runs it against an
                        empty data directory)
  Passed through to ops/deploy/deploy-kind.sh when --kubernetes is set:
  --reset              Delete and recreate the kind cluster
  --skip-build         Skip building local Docker images
  --skip-fabric-certs  Skip applying the fabric-certs Secret
  --infra-only         Deploy platform/Kafka layers only, skip app services
  --skip-app-images    Skip building AND loading app images into kind
  --no-wait            Don't block waiting for pods to become ready
  --environment ENV    Overlay environment name (default: dev)
EOF
        exit 0
        ;;
    *) fail "Unknown option: $1" ;;
    esac
    shift
done
ensure_docker_group "${ORIGINAL_ARGS[@]}"
ensure_setup() {
    if ((SKIP_SETUP == 1)); then
        warn "Skipping setup (--skip-setup)"
        mkdir -p .pids logs bin fabric/network/channel-artifacts
        return 0
    fi
    local args=()
    ((USE_KUBERNETES == 1)) && args+=(--kubernetes-only)
    [[ -d node_modules ]] && args+=(--skip-install)
    bash "$SCRIPT_DIR/setup.sh" "${args[@]+"${args[@]}"}"
}
try_wait_for_tcp() {
    local timeout_seconds="$1"
    shift
    local deadline=$((SECONDS + timeout_seconds))
    local port
    while ((SECONDS < deadline)); do
        local all_open=1
        for port in "$@"; do
            if ! (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
                all_open=0
                break
            fi
        done
        if ((all_open == 1)); then
            return 0
        fi
        sleep 2
    done
    return 1
}
if ((USE_KUBERNETES == 1)); then
    echo "RoadWatch — Kubernetes mode (--kubernetes)"
    ensure_setup
    step "Kubernetes deploy (kind)"
    have_cmd docker || fail "docker required"
    docker_ready || fail "Docker daemon is not running"
    have_cmd kind || fail "kind required — https://kind.sigs.k8s.io/"
    have_cmd kubectl || fail "kubectl required"
    DEPLOY_KIND_SCRIPT="$REPO_ROOT/ops/deploy/deploy-kind.sh"
    [[ -f "$DEPLOY_KIND_SCRIPT" ]] || fail "Missing: $DEPLOY_KIND_SCRIPT"
    [[ -x "$DEPLOY_KIND_SCRIPT" ]] || fail "$DEPLOY_KIND_SCRIPT is not executable — run: chmod +x ops/deploy/deploy-kind.sh"
    "$DEPLOY_KIND_SCRIPT" "${KIND_DEPLOY_ARGS[@]+"${KIND_DEPLOY_ARGS[@]}"}"
    exit 0
fi
echo "RoadWatch — Local dev mode (Docker Compose + background services)"
ensure_setup
GATEWAY_PORT="${ROADWATCH_GATEWAY_PORT:-3100}"
GATEWAY_URL="http://localhost:${GATEWAY_PORT}"
LOCAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${TOP_PGBOUNCER_HOST_PORT:-16432}/roadwatch"
LOCAL_REDIS_URL="redis://127.0.0.1:${TOP_REDIS_HOST_PORT:-16379}/0"
POSTGRES_HOST_PORT="${TOP_POSTGRES_HOST_PORT:-15433}"
PGBOUNCER_HOST_PORT="${TOP_PGBOUNCER_HOST_PORT:-16432}"
VITE_PORT="${VITE_PORT:-5173}"
export DATABASE_URL="$LOCAL_DATABASE_URL"
export REDIS_URL="$LOCAL_REDIS_URL"
export GATEWAY_URL
for f in \
    .pids/fabric.pid \
    .pids/gateway-api.pid \
    .pids/backend-api.pid \
    .pids/scheduler.pid \
    .pids/webhook-handler.pid \
    .pids/fabric-anchor-consumer.pid \
    .pids/frontend.pid; do
    stop_pidfile "$f"
done
step "Docker infrastructure (Postgres, Redis, Kafka)"
have_cmd docker || fail "docker required — $PKG_HINT docker docker-compose"
docker_ready || fail "Docker daemon is not running. Arch: sudo systemctl enable --now docker"

# Postgres only executes files in docker/postgres/init.sql (mounted at
# /docker-entrypoint-initdb.d) the FIRST time it starts against an empty
# postgres_data volume. If the volume already exists, init.sql is silently
# skipped on every subsequent start.
PG_VOLUME="$(docker volume ls -q | grep -E '_postgres_data$' | head -n1 || true)"
if ((RESET_DB == 1)); then
    if [[ -n "$PG_VOLUME" ]]; then
        warn "Resetting Postgres volume (--reset-db): $PG_VOLUME — all local DB data will be lost"
        docker compose rm -sf postgres >/dev/null 2>&1 || true
        docker volume rm "$PG_VOLUME"
    else
        warn "Resetting Postgres (--reset-db) — no existing volume found, nothing to remove"
    fi
    PG_VOLUME=""
fi
if [[ -n "$PG_VOLUME" ]]; then
    warn "Postgres volume '$PG_VOLUME' already exists — docker/postgres/init.sql will NOT run (Postgres only runs it on first init). Use --reset-db to force it."
else
    echo "  No existing postgres volume found — docker/postgres/init.sql will run on first boot."
fi

echo "  docker compose up -d ..."
docker compose up -d
GRAFANA_PORT="${TOP_GRAFANA_HOST_PORT:-30301}"
step "Observability (Prometheus, Grafana)"
echo "  Waiting for Prometheus (9090) and Grafana ($GRAFANA_PORT)..."
if try_wait_for_tcp 120 9090 "$GRAFANA_PORT"; then
    ok "Observability stack ready"
else
    warn "Prometheus/Grafana not all ready yet — continuing"
fi
echo "  Waiting for Postgres ($POSTGRES_HOST_PORT) and PgBouncer ($PGBOUNCER_HOST_PORT)..."
wait_for_tcp 120 "$POSTGRES_HOST_PORT" "$PGBOUNCER_HOST_PORT"
ok "Database ports open"
echo "  Waiting for Kafka (9094, 9095) and Redis (16379)..."
if try_wait_for_tcp 120 9094 9095 16379; then
    ok "Messaging + cache ready"
else
    warn "Kafka/Redis not all ready yet — continuing"
fi
if ((SKIP_FABRIC == 0)); then
    step "Hyperledger Fabric"
    export PATH="$REPO_ROOT/bin:${PATH:-/usr/bin}"
    mkdir -p logs
    (
        cd "$REPO_ROOT/fabric/network"
        exec ./scripts/start.sh
    ) >logs/fabric.log 2>&1 &
    echo $! >.pids/fabric.pid
    ok "Fabric start launched (PID $(cat .pids/fabric.pid)) — logs/fabric.log"
    sleep 3
else
    warn "Skipping Fabric (--skip-fabric)"
fi
step "Database seed"
if ((SKIP_SEED == 1)) || [[ "${ROADWATCH_SKIP_DB_SEED:-}" == "1" ]]; then
    warn "Skipped (--skip-seed)"
else
    DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:${POSTGRES_HOST_PORT}/roadwatch"
    if DATABASE_URL="$DIRECT_URL" pnpm seed:demo; then
        ok "Seeded"
    else
        warn "seed failed — continuing"
    fi
fi
BACKEND_PORT="${BACKEND_PORT:-4001}"
if port_in_use "$BACKEND_PORT"; then
    BACKEND_PORT=5001
fi
step "Application services"
mkdir -p logs .pids
nohup env \
    NODE_ENV=development \
    DATABASE_URL="$LOCAL_DATABASE_URL" \
    REDIS_URL="$LOCAL_REDIS_URL" \
    KAFKA_HLF_BROKERS=127.0.0.1:9094 \
    KAFKA_EVENTS_BROKERS=127.0.0.1:9095 \
    KAFKA_BROKERS=127.0.0.1:9095 \
    GATEWAY_URL="$GATEWAY_URL" \
    JWT_SECRET=roadwatch-local-dev-jwt-secret-replace-in-production \
    ALLOW_DEV_OTP_ECHO=true \
    SERVICE_NAME=gateway \
    SERVICE_URL="$GATEWAY_URL" \
    PORT="$GATEWAY_PORT" \
    pnpm --filter @roadwatch/gateway-api dev >logs/gateway-api.log 2>&1 &
echo $! >.pids/gateway-api.pid
ok "Gateway (PID $(cat .pids/gateway-api.pid))"
wait_for_http "$GATEWAY_URL/health" 120
ok "Gateway healthy"
nohup env \
    NODE_ENV=development \
    DATABASE_URL="$LOCAL_DATABASE_URL" \
    REDIS_URL="$LOCAL_REDIS_URL" \
    KAFKA_HLF_BROKERS=127.0.0.1:9094 \
    KAFKA_EVENTS_BROKERS=127.0.0.1:9095 \
    KAFKA_BROKERS=127.0.0.1:9095 \
    GATEWAY_URL="$GATEWAY_URL" \
    JWT_SECRET=roadwatch-local-dev-jwt-secret-replace-in-production \
    ALLOW_DEV_OTP_ECHO=true \
    SERVICE_NAME=backend-api \
    SERVICE_URL="http://127.0.0.1:$BACKEND_PORT" \
    BACKEND_PORT="$BACKEND_PORT" \
    pnpm --dir backend-api dev >logs/backend-api.log 2>&1 &
echo $! >.pids/backend-api.pid
ok "Backend (PID $(cat .pids/backend-api.pid))"
nohup env \
    NODE_ENV=development \
    DATABASE_URL="$LOCAL_DATABASE_URL" \
    REDIS_URL="$LOCAL_REDIS_URL" \
    KAFKA_HLF_BROKERS=127.0.0.1:9094 \
    KAFKA_EVENTS_BROKERS=127.0.0.1:9095 \
    KAFKA_BROKERS=127.0.0.1:9095 \
    GATEWAY_URL="$GATEWAY_URL" \
    JWT_SECRET=roadwatch-local-dev-jwt-secret-replace-in-production \
    ALLOW_DEV_OTP_ECHO=true \
    SERVICE_NAME=scheduler \
    SERVICE_URL=service://scheduler \
    pnpm --dir services/scheduler dev >logs/scheduler.log 2>&1 &
echo $! >.pids/scheduler.pid
ok "Scheduler (PID $(cat .pids/scheduler.pid))"
nohup env \
    NODE_ENV=development \
    DATABASE_URL="$LOCAL_DATABASE_URL" \
    REDIS_URL="redis://127.0.0.1:16379/1" \
    KAFKA_HLF_BROKERS=127.0.0.1:9094 \
    KAFKA_EVENTS_BROKERS=127.0.0.1:9095 \
    KAFKA_BROKERS=127.0.0.1:9095 \
    GATEWAY_URL="$GATEWAY_URL" \
    JWT_SECRET=roadwatch-local-dev-jwt-secret-replace-in-production \
    ALLOW_DEV_OTP_ECHO=true \
    SERVICE_NAME=webhook-handler \
    SERVICE_URL=service://webhook-handler \
    pnpm --dir services/webhook-handler dev >logs/webhook-handler.log 2>&1 &
echo $! >.pids/webhook-handler.pid
ok "Webhook (PID $(cat .pids/webhook-handler.pid))"
if ((SKIP_FABRIC == 0)); then
    nohup env \
        NODE_ENV=development \
        DATABASE_URL="$LOCAL_DATABASE_URL" \
        REDIS_URL="redis://127.0.0.1:16379/2" \
        KAFKA_HLF_BROKERS=127.0.0.1:9094 \
        KAFKA_EVENTS_BROKERS=127.0.0.1:9095 \
        KAFKA_BROKERS=127.0.0.1:9095 \
        GATEWAY_URL="$GATEWAY_URL" \
        JWT_SECRET=roadwatch-local-dev-jwt-secret-replace-in-production \
        ALLOW_DEV_OTP_ECHO=true \
        SERVICE_NAME=fabric-anchor-consumer \
        SERVICE_URL=service://fabric-anchor-consumer \
        pnpm --dir services/fabric-anchor-consumer dev >logs/fabric-anchor-consumer.log 2>&1 &
    echo $! >.pids/fabric-anchor-consumer.pid
    ok "Fabric anchor (PID $(cat .pids/fabric-anchor-consumer.pid))"
fi
nohup env \
    VITE_API_BASE="$GATEWAY_URL" \
    VITE_PORT="$VITE_PORT" \
    GATEWAY_URL="$GATEWAY_URL" \
    SERVICE_NAME=roadwatch-frontend \
    pnpm --filter roadwatch-frontend dev >logs/frontend.log 2>&1 &
echo $! >.pids/frontend.pid
ok "Frontend (PID $(cat .pids/frontend.pid))"
echo
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}  All services started${NC}"
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "  Frontend:  http://localhost:$VITE_PORT"
echo "  Gateway:   $GATEWAY_URL"
echo "  Backend:   http://localhost:$BACKEND_PORT"
echo
echo "  Logs:      tail -f logs/*.log"
echo "  Stop:      ./ops/dev/stop-all.sh   (or pnpm stop:all)"
echo
