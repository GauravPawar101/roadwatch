# 🚀 RoadWatch Setup Checklist

Before running any seeding or development, complete these steps in order.

## ✅ Phase 1: Environment & Dependencies

- [ ] **Install Docker Desktop** (Windows/Mac) or Docker Engine (Linux)
  - Verify: `docker --version && docker compose version`

- [ ] **Install Node.js LTS** (18+ recommended)
  - Verify: `node --version && npm --version`

- [ ] **Install pnpm** (package manager)
  ```bash
  npm install -g pnpm@8.10.0
  pnpm --version
  ```

- [ ] **Clone/Initialize repo**
  ```bash
  cd roadwatch
  pnpm install
  # Or via the setup script which also copies .env files and checks prerequisites:
  pnpm setup
  ```

---

## ✅ Phase 2: Environment Files

### Copy templates and fill in values:

- [ ] **Root level**: Copy `.env.template` to `.env` (if using root-level vars)

- [ ] **apps/gateway-api/.env**
  ```bash
  cp apps/gateway-api/.env.example apps/gateway-api/.env
  ```
  Fill in:
  - `DATABASE_URL` (target the PgBouncer-backed Postgres endpoint; the app uses `pg.Pool`)
  - `JWT_SECRET` (any random string)
  - `GEMINI_API_KEY` (get from aistudio.google.com — optional, will use fallbacks)
  - Keep `ALLOW_DEV_OTP_ECHO=true` for dev
  - Optional: `KAFKA_BROKER=127.0.0.1:9094` (if running Kafka)

- [ ] **docker/.env**
  ```bash
  cp docker/.env.example docker/.env
  ```
  Fill in:
  - `JWT_SECRET` (match gateway-api value)
  - `POSTGRES_PASSWORD` (if needed for your local Postgres container)

- [ ] **services/fabric-anchor-consumer/.env** (optional, if running Kafka consumer)
  ```bash
  cp services/fabric-anchor-consumer/.env.example services/fabric-anchor-consumer/.env
  ```
  Will update after Fabric network starts.

---

## ✅ Phase 3: Start Core Infrastructure

### Start Postgres
```bash
# From repo root
docker compose up -d postgres

# Verify it's healthy
docker compose ps
# Look for: roadwatch_postgres  ...  (healthy)

# Wait ~10-20 seconds for it to be ready
```

---

## ✅ Phase 4: Start Hyperledger Fabric Network

### Generate Fabric artifacts and start network
```bash
cd fabric/network

# Run start script (creates crypto material, genesis block, etc)
./scripts/start.sh

# This will:
# - Generate cryptographic material (MSP, certificates)
# - Generate channel artifacts (genesis.block, channel config TX)
# - Start Docker containers (orderer, 2 peers, 2 CAs)
# - Create channel (roadwatch-india)
# - Join both peers to the channel
# - Set anchor peers for both orgs
# - Deploy the complaint-anchor chaincode

# Verify all containers are running
docker ps | grep -E "(orderer|peer|ca)"
# You should see 5 containers

# Verify they're healthy
docker compose ps
# Look for healthy status on all services
```

# If start.sh fails:
```bash
# Check logs
docker compose logs orderer1
docker compose logs peer0.nhai.roadwatch.com

# Prefer a non-destructive restart first (preserves volumes/data):
docker compose stop
docker compose up -d

# If you need a full reset (remove containers + volumes/artifacts),
# run the Fabric start script with the explicit reset flag:
./scripts/start.sh --reset
```

### Optional parity check: RoadWatch peer join + anchor peer

If you want to re-run the second-peer path explicitly, use the RoadWatch admin context after the network is up:

```bash
cd fabric/network

export FABRIC_CFG_PATH=.
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=RoadWatchMSP
export CORE_PEER_TLS_ROOTCERT_FILE=organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp
export CORE_PEER_ADDRESS=localhost:19051

peer channel list
peer channel join -b roadwatch-india.block
peer channel list
```

The default `./scripts/start.sh` path already performs this join and the anchor-peer update for both orgs, so this block is only for explicit parity verification.

---

## ✅ Phase 5: Deploy Chaincode

```bash
cd fabric/network

# Deploy complaint-anchor chaincode
./scripts/deploy-chaincode.sh

# Verify it's committed
peer lifecycle chaincode querycommitted \
  --channelID roadwatch-india \
  --name complaint-anchor
```

---

## ✅ Phase 6: Update Fabric Environment Vars

After Fabric network is running, update env vars with actual cert paths:

### Find your Fabric identity paths:
```bash
cd fabric/network

# These should exist:
ls organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp/

# TLS CA cert
ls organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt

# Private key (there should be exactly 1 file)
ls organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp/keystore/
```

### Update `services/fabric-anchor-consumer/.env`:
```bash
FABRIC_TLS_CERT_PATH=../network/organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt
FABRIC_IDENTITY_CERT_PATH=../network/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp/signcerts/cert.pem
FABRIC_IDENTITY_KEY_PATH=../network/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp/keystore/priv_sk
```

---

## ✅ Phase 7: Verify Fabric Connectivity

### Test Fabric CLI with these scripts:
```bash
# From repo root

# Seed test complaints to Fabric
pnpm seed:fabric

# Query complaint history
pnpm query:fabric:history

# Query complaints by road
pnpm query:fabric:by-road
```

If these succeed, Fabric is properly configured. ✅

---

## ✅ Phase 8: Seed Database

### Start gateway-api (it auto-creates schema)
```bash
# Terminal 1: Gateway API
cd apps/gateway-api
pnpm dev
# Should log: "listening on port 3000"
```

### Seed backend database
```bash
# Terminal 2: Seed database
pnpm seed:demo

# This creates:
# - Countries (India)
# - States (Delhi, Maharashtra)
# - Districts (New Delhi, Mumbai, etc)
# - Roads (30+ roads across districts)
# - Contractors
# - Authority mappings
```

---

## ✅ Phase 9: Start Frontend (Optional)

```bash
# Terminal 3: Frontend dev server
cd frontend
pnpm dev
# Should log: "local: http://localhost:5173"
```

---

## ✅ Phase 10: Verify Everything Works

### Check all services are up:
```bash
# Services running
docker ps

# Gateway API
curl http://localhost:3100/health

# Frontend (if running)
curl http://localhost:5173

# Fabric network
docker compose -f fabric/network/docker/docker-compose.yaml ps
```

---

## 📊 Expected Final State

```
CONTAINER NAMES (6 total):
- roadwatch_postgres     [healthy]
- orderer1              [healthy]
- peer0.nhai            [healthy]
- ca.nhai               [healthy]
- peer0.roadwatch       [healthy]
- ca.roadwatch          [healthy]

PORTS (no conflicts):
- 5433   ← Postgres
- 7050   ← Orderer
- 7051   ← NHAI Peer
- 7054   ← NHAI CA
- 8054   ← RoadWatch CA
- 9051   ← RoadWatch Peer
- 3000   ← Gateway API (if running)
- 5173   ← Frontend (if running)

DATABASES:
- roadwatch_local (Postgres) with tables created
- roadwatch-india channel on Fabric
- complaint-anchor chaincode deployed v0.0.1

DATA:
- 30 roads across Delhi
- 3 contractors
- 2 authority orgs configured
```

---

## 🔧 Troubleshooting Quick Reference

| Problem | Solution |
|---------|----------|
| Port already in use | Kill process: `lsof -i :PORT` then `kill -9 PID` |
| Postgres won't connect | Check if container is healthy: `docker compose ps` |
| Fabric scripts fail | Verify paths are relative to `fabric/network/` directory |
| "permission denied" in Fabric | Files generated by Docker may be root-owned; use Docker to clean: `docker compose run --rm peer chmod -R 777 /path` |
| LevelDB vs CouchDB | Default is LevelDB; enable CouchDB with `--profile couchdb` |
| Out of memory | Reduce `deploy.resources.limits.memory` in compose files |
| Can't find `peer` command | Verify `bin/` binaries extracted or `export PATH=$PWD/bin:$PATH` |

---

## ✅ Once Complete

You can now:
- ✅ Seed 30 Delhi roads into database
- ✅ Submit complaints through the frontend
- ✅ Anchor complaint hashes to Fabric
- ✅ Query complaint history
- ✅ Test authority workflows
- ✅ Run performance evaluations
- ✅ Test citizen/contractor/authority flows

**Happy hacking! 🚀**
