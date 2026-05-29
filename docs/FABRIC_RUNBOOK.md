# Fabric Runbook

This runbook covers the local Hyperledger Fabric environment used by RoadWatch, including startup, redeployment, verification, and common failure checks.

## What this covers

- Fabric network startup and shutdown.
- Channel creation and chaincode deployment.
- Ledger inspection and complaint history queries.
- Seeded test data and local development workflows.

## Prerequisites

- Docker Desktop or an equivalent container runtime.
- Project dependencies installed with `pnpm install`.
- Fabric binaries and network assets available in the repository.
- Environment variables configured as described in [docs/infrastructure/setup-checklist.md](./infrastructure/setup-checklist.md).

## Start the network

From `fabric/network/`:

1. Start the network and create the channel:

   `./scripts/start.sh`

2. Verify the container set is healthy:

   `docker compose ps`

3. Confirm the expected channel name:

   `roadwatch-india`

## Deploy chaincode

From `fabric/network/`:

1. Package, install, approve, and commit the chaincode:

   `./scripts/deploy-chaincode.sh`

2. If the chaincode changes, bump `FABRIC_CC_VERSION` or `FABRIC_CC_SEQUENCE` before redeploying.
3. Use `FABRIC_CC_INVOKE_INIT_LEDGER=1` only when you intentionally want seeded ledger state.

## Verify ledger access

Useful checks:

- Query complaint history with `pnpm query:fabric:history`.
- Query complaints by road with `pnpm query:fabric:by-road`.
- Inspect current ledger state with the Fabric CLI helpers in `scripts/fabric-ledger.ts`.

## Common issues

- If the network fails to start, check container logs first.
- If chaincode deployment hangs, verify the peers, orderer, and CouchDB containers are healthy.
- If rich queries fail, confirm the peer state database is configured for CouchDB.
- If local data appears stale, confirm whether a reset was intentionally requested.

## Recovery steps

1. Stop the network with the project stop scripts or `docker compose stop`.
2. Re-run the network start script.
3. Redeploy chaincode if the package or sequence changed.
4. Re-seed only the data needed for the current test.

## Related files

- [README.md](../README.md)
- [docs/INDEX.md](./INDEX.md)
- [docs/infrastructure/setup-checklist.md](./infrastructure/setup-checklist.md)
- [docs/testing/fabric-integration-testing.md](./testing/fabric-integration-testing.md)
