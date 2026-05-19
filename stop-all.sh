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

# Stop Gateway API
if [ -f .pids/gateway-api.pid ]; then
    GATEWAY_PID=$(cat .pids/gateway-api.pid)
    echo "Stopping Gateway API (PID: $GATEWAY_PID)..."
    kill $GATEWAY_PID 2>/dev/null || echo "Process already stopped"
    rm .pids/gateway-api.pid
    echo -e "${GREEN}✓ Gateway API stopped${NC}"
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
