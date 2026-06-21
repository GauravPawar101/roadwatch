#!/bin/bash
# stop-all.sh - Stop all RoadWatch services

set -e

echo "🛑 Stopping RoadWatch Services..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Stop Frontend
if [ -f .pids/frontend.pid ]; then
    FRONTEND_PID=$(cat .pids/frontend.pid)
    echo "Stopping Frontend (PID: $FRONTEND_PID)..."
    kill $FRONTEND_PID 2>/dev/null || echo "Process already stopped"
    rm .pids/frontend.pid
    echo -e "${GREEN}✓ Frontend stopped${NC}"
fi

# Stop Backend API
if [ -f .pids/backend-api.pid ]; then
    BACKEND_PID=$(cat .pids/backend-api.pid)
    echo "Stopping Backend API (PID: $BACKEND_PID)..."
    kill $BACKEND_PID 2>/dev/null || echo "Process already stopped"
    rm .pids/backend-api.pid
    echo -e "${GREEN}✓ Backend API stopped${NC}"
fi

# Stop Gateway API
if [ -f .pids/gateway-api.pid ]; then
    GATEWAY_PID=$(cat .pids/gateway-api.pid)
    echo "Stopping Gateway API (PID: $GATEWAY_PID)..."
    kill $GATEWAY_PID 2>/dev/null || echo "Process already stopped"
    rm .pids/gateway-api.pid
    echo -e "${GREEN}✓ Gateway API stopped${NC}"
fi

# Stop Scheduler
if [ -f .pids/scheduler.pid ]; then
    SCHEDULER_PID=$(cat .pids/scheduler.pid)
    echo "Stopping Scheduler (PID: $SCHEDULER_PID)..."
    kill $SCHEDULER_PID 2>/dev/null || echo "Process already stopped"
    rm .pids/scheduler.pid
    echo -e "${GREEN}✓ Scheduler stopped${NC}"
fi

# Stop Webhook Handler
if [ -f .pids/webhook-handler.pid ]; then
    WEBHOOK_PID=$(cat .pids/webhook-handler.pid)
    echo "Stopping Webhook Handler (PID: $WEBHOOK_PID)..."
    kill $WEBHOOK_PID 2>/dev/null || echo "Process already stopped"
    rm .pids/webhook-handler.pid
    echo -e "${GREEN}✓ Webhook Handler stopped${NC}"
fi

# Stop Fabric Anchor Consumer
if [ -f .pids/fabric-anchor-consumer.pid ]; then
    FABRIC_ANCHOR_PID=$(cat .pids/fabric-anchor-consumer.pid)
    echo "Stopping Fabric Anchor Consumer (PID: $FABRIC_ANCHOR_PID)..."
    kill $FABRIC_ANCHOR_PID 2>/dev/null || echo "Process already stopped"
    rm .pids/fabric-anchor-consumer.pid
    echo -e "${GREEN}✓ Fabric Anchor Consumer stopped${NC}"
fi

# Stop Fabric in WSL
echo "Stopping Hyperledger Fabric in WSL..."
wsl bash -c "cd /mnt/c/$(pwd | sed 's|C:/|/c/|' | sed 's|\\|/|g')/fabric/network && docker compose -f docker/docker-compose.yaml stop"
echo -e "${GREEN}✓ Hyperledger Fabric stopped${NC}"

# Stop Docker services
echo "Stopping Docker services..."
docker-compose stop
echo -e "${GREEN}✓ PostgreSQL stopped${NC}"

echo ""
echo -e "${GREEN}✨ All services stopped${NC}"
