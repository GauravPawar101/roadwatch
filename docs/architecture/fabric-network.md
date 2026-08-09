# Fabric Network

RoadWatch uses Hyperledger Fabric for immutable complaint anchoring. The deployed dev network differs from aspirational multi-org designs documented in early planning — this page describes what is actually in the repo.

## Deployed topology

### Organizations

| Org | MSP ID | Domain | Peer |
|-----|--------|--------|------|
| Orderer | `OrdererMSP` | `orderer.roadwatch.com` | `orderer1` (Raft; 3 orderers configured, 1 active in dev) |
| NHAI | `NHAIMSP` | `nhai.roadwatch.com` | `peer0.nhai.roadwatch.com` |
| RoadWatch | `RoadWatchMSP` | `roadwatch.roadwatch.com` | `peer0.roadwatch.roadwatch.com` |

Each peer org has its own Fabric CA.

### Channel

| Setting | Value |
|---------|-------|
| Channel name | `roadwatch-india` |
| Config profile | `RoadWatchIndiaChannel` |
| Consortium | `RoadWatchConsortium` (NHAI + RoadWatch) |

### Chaincodes in repository

| Chaincode | Path | Deployed by default |
|-----------|------|---------------------|
| **complaint-anchor** | `fabric/chaincode/complaint-anchor/` | **Yes** — primary anchoring chaincode |
| authority-registry | `fabric/chaincode/authority-registry/` | No |
| road-registry | `fabric/chaincode/road-registry/` | No |
| budget-registry | `fabric/chaincode/budget-registry/` | No |
| global-routing | `fabric/chaincode/global-routing/` | No |
| roadwatch-chaincode (TS) | `chaincode/` | Stub only |

### complaint-anchor functions

- Anchor Merkle root of complaint batch
- Query complaint history by ID
- Query complaints by road ID
- Get escalation history (requires CouchDB rich queries)

## Dev ports

| Component | Host port |
|-----------|-----------|
| Orderer | 17050 |
| peer0.nhai | 17051 (chaincode 17052, CA 17054) |
| peer0.roadwatch | 19051 (chaincode 19052, CA 18054) |

## State database

Controlled by `FABRIC_LEDGER_STATE_DB` in `fabric/network/.env`:

| Value | Behavior |
|-------|----------|
| `goleveldb` | Default in `.env.example`; no rich queries |
| `CouchDB` | Enables Mango queries; start script enables `couchdb` Docker profile |

CouchDB index for escalation history: `fabric/chaincode/complaint-anchor/META-INF/statedb/couchdb/indexes/complaintid_timestamp_index.json`

## Lifecycle commands

From repo root (runs inside WSL):

```powershell
pnpm fabric:start     # Start network + create/join channel
pnpm fabric:deploy    # Package → install → approve → commit chaincode
pnpm fabric:reset     # Full teardown + regenerate artifacts
pnpm fabric:seed      # Seed test complaints on ledger
```

Direct scripts in `fabric/network/scripts/`:

```bash
./scripts/start.sh              # Start (preserves artifacts)
./scripts/start.sh --reset      # Full reset
./scripts/deploy-chaincode.sh   # Deploy complaint-anchor
```

Bump `FABRIC_CC_VERSION` or `FABRIC_CC_SEQUENCE` in `fabric/network/.env` to redeploy updated chaincode.

## Kubernetes integration

Fabric runs **outside** the k8s cluster on the Docker host. The `fabric-anchor` deployment reaches peers via `hostAliases` and the `FABRIC_HOST_IP` injected by deploy scripts. Certificates are mounted from the `fabric-certs` Secret.

See [Kubernetes architecture](./kubernetes.md) Layer 5.

## What is NOT deployed

Early design docs reference CitizenOrg, PWDOrg, and AuditOrg with a 4-org endorsement policy. The current dev network uses **two peer orgs** (NHAI + RoadWatch) only. Multi-org endorsement rules are not enforced in the deployed channel config.

## Related docs

- [Fabric deployment](../infrastructure/fabric-deployment.md)
- [Blockchain anchoring workflow](../workflows/blockchain-anchoring.md)
- [Fabric anchor consumer](../services/fabric-anchor-consumer.md)
