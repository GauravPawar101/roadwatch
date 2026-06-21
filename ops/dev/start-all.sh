#!/bin/bash
# start-all.sh - Start all RoadWatch services
# Usage: ./start-all.sh

set -e

echo "🚀 Starting RoadWatch Services..."
echo ""

LOCAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${TOP_PGBOUNCER_HOST_PORT:-16432}/roadwatch"
LOCAL_REDIS_URL="redis://127.0.0.1:${TOP_REDIS_HOST_PORT:-16379}/0"
SERVICE_REGISTRY_SECRET="${SERVICE_REGISTRY_SECRET:-roadwatch-local-service-registry-secret}"
SERVICE_AUTH_SECRET="${SERVICE_AUTH_SECRET:-local_development_cryptographic_secret}"
GATEWAY_PORT="${ROADWATCH_GATEWAY_PORT:-3100}"
GATEWAY_URL="http://localhost:${GATEWAY_PORT}"

# Pin local dev to the Docker PgBouncer endpoint so inherited environment
# variables cannot redirect the gateway to a different Postgres port.
export DATABASE_URL="$LOCAL_DATABASE_URL"
export SERVICE_REGISTRY_SECRET="$SERVICE_REGISTRY_SECRET"
export SERVICE_AUTH_SECRET="$SERVICE_AUTH_SECRET"
export GATEWAY_URL="$GATEWAY_URL"

wait_for_http() {
    local url="$1"
    local timeout_seconds="${2:-90}"
    local deadline=$((SECONDS + timeout_seconds))

    until curl -fsS "$url" >/dev/null 2>&1; do
        if [ "$SECONDS" -ge "$deadline" ]; then
            echo "Timed out waiting for $url" >&2
            exit 1
        fi
        sleep 1
    done
}

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
ORANGE='\033[0;33m'
NC='\033[0m' # No Color

# Step 1: Start Postgres
echo -e "${BLUE}📦 Step 1: Starting PostgreSQL, Kafka, Redis, and Zookeeper...${NC}"
docker-compose up -d postgres zookeeper kafka redis
echo -e "${GREEN}✓ Infrastructure services started${NC}"
echo ""

mkdir -p .pids logs

# Step 2: Start Hyperledger Fabric in WSL
echo -e "${BLUE}⛓️  Step 2: Starting Hyperledger Fabric in WSL...${NC}"
echo "This will start the Fabric network and deploy chaincode..."
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT_WSL="$(wslpath "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"
if command -v wsl >/dev/null 2>&1; then
    wsl -d Ubuntu -- bash -lc "source ~/.profile >/dev/null 2>&1; cd ${REPO_ROOT_WSL}/fabric/network; ./scripts/start.sh"
else
    source ~/.profile >/dev/null 2>&1
    cd "${REPO_ROOT}/fabric/network"
    ./scripts/start.sh
fi
echo -e "${GREEN}✓ Hyperledger Fabric network started${NC}"
echo ""

# Step 3: Seed backend database (optional, only if needed)
echo -e "${BLUE}🌱 Step 3: Seeding backend database (optional)...${NC}"
read -p "Do you want to seed the database? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    pnpm seed:demo
    echo -e "${GREEN}✓ Database seeded${NC}"
else
    echo "Skipping database seed"
fi
echo ""

# Step 4: Start Gateway API
echo -e "${BLUE}🔌 Step 4: Starting Gateway API...${NC}"
echo "Gateway API will run on ${GATEWAY_URL}"
echo "Starting in background..."
DATABASE_URL="$LOCAL_DATABASE_URL" REDIS_URL="$LOCAL_REDIS_URL" SERVICE_REGISTRY_SECRET="$SERVICE_REGISTRY_SECRET" SERVICE_AUTH_SECRET="$SERVICE_AUTH_SECRET" pnpm --filter @roadwatch/gateway-api dev > logs/gateway-api.log 2>&1 &
GATEWAY_PID=$!
echo $GATEWAY_PID > .pids/gateway-api.pid
echo -e "${GREEN}✓ Gateway API started (PID: $GATEWAY_PID)${NC}"
echo ""

echo -e "${BLUE}⏳ Waiting for Gateway API to become healthy...${NC}"
wait_for_http "${GATEWAY_URL}/health" 120
echo -e "${GREEN}✓ Gateway API is healthy${NC}"
echo ""

# Determine a usable backend port (prefer 4001; fall back to 5001)
BACKEND_PORT="${BACKEND_PORT:-4001}"
if (exec 3<>/dev/tcp/127.0.0.1/${BACKEND_PORT}) 2>/dev/null; then
    BACKEND_PORT=5001
fi
export BACKEND_PORT

# Step 5: Start Backend API
echo -e "${BLUE}🔧 Step 5: Starting Backend API...${NC}"
echo "Backend API will run on http://localhost:${BACKEND_PORT}"
echo "Starting in background..."
SERVICE_NAME="backend-api" SERVICE_URL="http://127.0.0.1:${BACKEND_PORT}" DATABASE_URL="$LOCAL_DATABASE_URL" REDIS_URL="$LOCAL_REDIS_URL" GATEWAY_URL="$GATEWAY_URL" SERVICE_REGISTRY_SECRET="$SERVICE_REGISTRY_SECRET" SERVICE_AUTH_SECRET="$SERVICE_AUTH_SECRET" BACKEND_PORT="$BACKEND_PORT" pnpm --dir backend-api dev > logs/backend-api.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > .pids/backend-api.pid
echo -e "${GREEN}✓ Backend API started (PID: $BACKEND_PID)${NC}"
echo ""

# Step 6: Start Scheduler
echo -e "${BLUE}🗓️  Step 6: Starting Scheduler...${NC}"
SERVICE_NAME="scheduler" SERVICE_URL="service://scheduler" DATABASE_URL="$LOCAL_DATABASE_URL" REDIS_URL="$LOCAL_REDIS_URL" GATEWAY_URL="$GATEWAY_URL" SERVICE_REGISTRY_SECRET="$SERVICE_REGISTRY_SECRET" SERVICE_AUTH_SECRET="$SERVICE_AUTH_SECRET" pnpm --dir services/scheduler dev > logs/scheduler.log 2>&1 &
SCHEDULER_PID=$!
echo $SCHEDULER_PID > .pids/scheduler.pid
echo -e "${GREEN}✓ Scheduler started (PID: $SCHEDULER_PID)${NC}"
echo ""

# Step 7: Start Webhook Handler
echo -e "${BLUE}🪝 Step 7: Starting Webhook Handler...${NC}"
SERVICE_NAME="webhook-handler" SERVICE_URL="service://webhook-handler" DATABASE_URL="$LOCAL_DATABASE_URL" REDIS_URL="$LOCAL_REDIS_URL" GATEWAY_URL="$GATEWAY_URL" SERVICE_REGISTRY_SECRET="$SERVICE_REGISTRY_SECRET" SERVICE_AUTH_SECRET="$SERVICE_AUTH_SECRET" pnpm --dir services/webhook-handler dev > logs/webhook-handler.log 2>&1 &
WEBHOOK_PID=$!
echo $WEBHOOK_PID > .pids/webhook-handler.pid
echo -e "${GREEN}✓ Webhook Handler started (PID: $WEBHOOK_PID)${NC}"
echo ""

# Step 8: Start Fabric anchor consumer once the Fabric network is up
echo -e "${BLUE}⛓️  Step 8: Starting Fabric anchor consumer...${NC}"
SERVICE_NAME="fabric-anchor-consumer" SERVICE_URL="service://fabric-anchor-consumer" DATABASE_URL="$LOCAL_DATABASE_URL" REDIS_URL="$LOCAL_REDIS_URL" GATEWAY_URL="$GATEWAY_URL" SERVICE_REGISTRY_SECRET="$SERVICE_REGISTRY_SECRET" SERVICE_AUTH_SECRET="$SERVICE_AUTH_SECRET" pnpm --dir services/fabric-anchor-consumer dev > logs/fabric-anchor-consumer.log 2>&1 &
FABRIC_ANCHOR_PID=$!
echo $FABRIC_ANCHOR_PID > .pids/fabric-anchor-consumer.pid
echo -e "${GREEN}✓ Fabric Anchor Consumer started (PID: $FABRIC_ANCHOR_PID)${NC}"
echo ""

# Step 9: Start Frontend
echo -e "${BLUE}🌐 Step 9: Starting Frontend...${NC}"
echo "Frontend will run on http://localhost:5173"
echo "Starting in background..."
VITE_API_BASE="$GATEWAY_URL" pnpm --filter roadwatch-frontend dev > logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > .pids/frontend.pid
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"
echo ""

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ All services started successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📋 Service URLs:${NC}"
echo "  • Frontend:          http://localhost:5173"
echo "  • Gateway API:       http://localhost:3100"
echo "  • Backend API:       http://localhost:${BACKEND_PORT}"
echo "  • Scheduler:         service://scheduler"
echo "  • Webhook Handler:   service://webhook-handler"
echo "  • Fabric Anchor:     service://fabric-anchor-consumer"
echo "  • PostgreSQL:        localhost:5433"
echo "  • Kafka:             localhost:9094"
echo "  • Redis:             localhost:16379"
echo "  • Fabric Peer NHAI:  localhost:7051"
echo "  • Fabric Peer RW:    localhost:9051"
echo "  • Fabric Orderer:    localhost:7050"
echo ""
echo -e "${YELLOW}📝 Logs:${NC}"
echo "  • Gateway API:       tail -f logs/gateway-api.log"
echo "  • Backend API:       tail -f logs/backend-api.log"
echo "  • Scheduler:         tail -f logs/scheduler.log"
echo "  • Webhook Handler:   tail -f logs/webhook-handler.log"
echo "  • Fabric Anchor:     tail -f logs/fabric-anchor-consumer.log"
echo "  • Frontend:          tail -f logs/frontend.log"
echo ""
echo -e "${YELLOW}🛑 To stop all services:${NC}"
echo "  ./stop-all.sh"
echo ""
