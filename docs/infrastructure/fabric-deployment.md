# Fabric Deployment

Step-by-step guide to deploying the Hyperledger Fabric network for RoadWatch.

## Prerequisites

- WSL 2 with Ubuntu 22.04
- Docker Desktop with WSL integration enabled
- Fabric binaries in WSL: `peer`, `cryptogen`, `configtxgen`, `configtxlator`
- `jq` and `openssl` in WSL

## Quick start (from repo root)

```powershell
pnpm fabric:start     # Start network + create/join channel
pnpm fabric:deploy    # Deploy complaint-anchor chaincode
pnpm fabric:seed      # Seed test complaints
```

These commands run inside WSL via the root `package.json` scripts.

## Manual steps (inside WSL)

```bash
cd fabric/network

# 1. Copy env
cp .env.example .env

# 2. Start network
./scripts/start.sh

# 3. Deploy chaincode
./scripts/deploy-chaincode.sh

# 4. Optional: seed ledger
FABRIC_CC_INVOKE_INIT_LEDGER=1 ./scripts/deploy-chaincode.sh
```

## Configuration

Edit `fabric/network/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `FABRIC_CHANNEL` | `roadwatch-india` | Channel name |
| `FABRIC_CHAINCODE` | `complaint-anchor` | Chaincode name |
| `FABRIC_LEDGER_STATE_DB` | `goleveldb` | State DB (`goleveldb` or `CouchDB`) |
| `FABRIC_CC_VERSION` | `0.0.1` | Chaincode version |
| `FABRIC_CC_SEQUENCE` | `1` | Chaincode sequence number |

### CouchDB (rich queries)

To enable Mango queries (required for `GetEscalationHistory`):

```bash
# In fabric/network/.env
FABRIC_LEDGER_STATE_DB=CouchDB
```

The start script automatically enables the `couchdb` Docker profile when this is set.

### Redeploying updated chaincode

Bump at least one of:

- `FABRIC_CC_VERSION` (e.g. `0.0.2`)
- `FABRIC_CC_SEQUENCE` (e.g. `2`)

Then run `./scripts/deploy-chaincode.sh` again.

## Reset

```powershell
pnpm fabric:reset
# or inside WSL:
./scripts/start.sh --reset
```

This tears down the network, deletes generated crypto material, and regenerates everything. **All ledger data is lost.**

## Ops wrappers

| Script | Purpose |
|--------|---------|
| `ops/deploy/fabric-start.sh` | Full bootstrap (WSL) |
| `ops/deploy/fabric-deploy-chaincode.sh` | Chaincode lifecycle |
| `ops/deploy/fabric-env.sh` | Source Fabric env vars |

## Fabric anchor consumer setup

After the network is running, configure the consumer:

```powershell
Copy-Item services/fabric-anchor-consumer/.env.example services/fabric-anchor-consumer/.env
# Edit with Fabric peer endpoint, MSP ID, cert paths
pnpm dev:fabric-consumer
```

## Kubernetes

Fabric runs **outside** the k8s cluster. See [Kubernetes architecture](../architecture/kubernetes.md) Layer 5 for how `fabric-anchor` pods reach peers via `hostAliases`.

## Generated artifacts (gitignored)

| Path | Contents |
|------|----------|
| `fabric/network/organizations/` | Crypto material (certs, keys) |
| `fabric/network/channel-artifacts/` | Channel genesis, tx files |
| `fabric/network/system-genesis-block/` | Genesis block |

Never commit these directories.

## Related docs

- [Fabric network](../architecture/fabric-network.md)
- [Blockchain anchoring](../workflows/blockchain-anchoring.md)
- [Fabric anchor consumer](../services/fabric-anchor-consumer.md)
