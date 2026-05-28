# Fabric integration testing (local)

This repo includes an **opt-in** Fabric integration test suite in `tests/fabric/`.

## What you get

- `pnpm test:fabric` runs `tests/fabric/chaincode.integration.test.ts`
- The test connects via `@hyperledger/fabric-gateway` and:
  - submits `CreateComplaint` (with transient PII)
  - evaluates `GetComplaintHistory`

## Why opt-in?

Fabric networks are heavy and OS/environment dependent.
We keep the suite deterministic, but you must bring a local network + deployed chaincode.

## Required env vars

Set these before running `pnpm test:fabric`:

- `FABRIC_TEST_ENABLED=1`
- `FABRIC_PEER_ENDPOINT` (example: `localhost:7051`)
- `FABRIC_PEER_HOST_ALIAS` (example: `peer0.org1.example.com`)
- `FABRIC_TLS_CERT_PATH` (path to peer TLS CA cert)
- `FABRIC_MSP_ID` (example: `Org1MSP` or `CitizenOrgMSP`)
- `FABRIC_IDENTITY_CERT_PATH` (path to user cert PEM)
- `FABRIC_IDENTITY_KEY_PATH` (path to user key PEM)
- `FABRIC_CHANNEL` (example: `mychannel`)
- `FABRIC_CHAINCODE` (example: `roadwatch`)

## MSP note (important)

Chaincode restricts `CreateComplaint` by MSP.
- Default allowlist: `CitizenOrgMSP`
- Override for test networks: set chaincode container env `ALLOWED_CITIZEN_MSPS=Org1MSP` (or whatever your network uses)

This keeps production defaults strict while enabling testing on standard dev networks.

## Suggested local workflow (using RoadWatch Fabric)

1) Bring up the RoadWatch Fabric network:
- `cd fabric/network`
- `./scripts/start.sh`

2) Deploy chaincode from this repo:
- Ensure the chaincode package builds: `peer lifecycle chaincode package complaint-anchor.tar.gz --path ./fabric/chaincode/complaint-anchor --lang golang --label complaint-anchor_0.0.1`
- Use `./scripts/deploy-chaincode.sh` to install, approve, and commit it on `roadwatch-india`

3) Export env vars for the Fabric gateway connection.

4) Run the suite:
- `FABRIC_TEST_ENABLED=1 pnpm test:fabric`

If you want this to be fully one-command, we can add a dedicated bootstrap script once you confirm:
- target Fabric version
- expected MSP IDs + channel/chaincode names
