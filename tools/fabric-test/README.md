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

## Suggested local workflow (using fabric-samples test-network)

1) Bring up a local network using Hyperledger Fabric samples:
- Clone `hyperledger/fabric-samples`
- `cd test-network`
- `./network.sh up createChannel -ca`

2) Deploy chaincode from this repo (Node chaincode):
- Ensure chaincode builds: `pnpm -F roadwatch-chaincode run build`
- In the test-network folder, deploy:
  - `./network.sh deployCC -ccn roadwatch -ccp /absolute/path/to/roadWatch/chaincode -ccl javascript`

3) Export env vars for the Fabric gateway connection.

4) Run the suite:
- `FABRIC_TEST_ENABLED=1 pnpm test:fabric`

If you want this to be fully one-command, we can add a dedicated bootstrap script once you confirm:
- target Fabric version
- whether to standardize on `fabric-samples` test-network
- expected MSP IDs + channel/chaincode names
