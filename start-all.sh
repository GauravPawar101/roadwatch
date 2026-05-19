#!/bin/bash
# start-all.sh - Start all RoadWatch services
# Usage: ./start-all.sh

set -e

echo "🚀 Starting RoadWatch Services..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Start Postgres
echo -e "${BLUE}📦 Step 1: Starting PostgreSQL, Kafka, Redis, and Zookeeper...${NC}"
docker-compose up -d postgres zookeeper kafka redis
echo -e "${GREEN}✓ Infrastructure services started${NC}"
echo ""

# Step 2: Start Hyperledger Fabric in WSL
echo -e "${BLUE}⛓️  Step 2: Starting Hyperledger Fabric in WSL...${NC}"
echo "This will start the Fabric network and deploy chaincode..."
wsl bash -c "cd ./fabric/network && ./scripts/start.sh"
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
echo "Gateway API will run on http://localhost:3100"
echo "Starting in background..."
pnpm --filter @roadwatch/gateway-api dev > logs/gateway-api.log 2>&1 &
GATEWAY_PID=$!
echo $GATEWAY_PID > .pids/gateway-api.pid
echo -e "${GREEN}✓ Gateway API started (PID: $GATEWAY_PID)${NC}"
echo ""

# Wait a bit for Gateway API to start
sleep 3

# Step 5: Start Frontend
echo -e "${BLUE}🌐 Step 5: Starting Frontend...${NC}"
echo "Frontend will run on http://localhost:5173"
echo "Starting in background..."
pnpm --filter roadwatch-frontend dev > logs/frontend.log 2>&1 &
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
echo "  • PostgreSQL:        localhost:5433"
echo "  • Kafka:             localhost:9094"
echo "  • Redis:             localhost:16379"
echo "  • Fabric Peer NHAI:  localhost:7051"
echo "  • Fabric Peer RW:    localhost:9051"
echo "  • Fabric Orderer:    localhost:7050"
echo ""
echo -e "${YELLOW}📝 Logs:${NC}"
echo "  • Gateway API:       tail -f logs/gateway-api.log"
echo "  • Frontend:          tail -f logs/frontend.log"
echo ""
echo -e "${YELLOW}🛑 To stop all services:${NC}"
echo "  ./stop-all.sh"
echo ""
