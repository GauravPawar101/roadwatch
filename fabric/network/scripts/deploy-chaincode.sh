#!/bin/bash
# fabric/network/scripts/deploy-chaincode.sh
#
# Deploys a chaincode to the local RoadWatch Fabric dev network using Fabric v2 lifecycle:
# package -> install -> approve (each org) -> commit.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Prefer repo-local Fabric binaries if present.
if [ -d "$ROOT_DIR/bin" ]; then
  export PATH="$ROOT_DIR/bin:$PATH"
fi

# peer reads core.yaml from FABRIC_CFG_PATH; core.yaml expects organizations/* relative to it.
cp -f "$ROOT_DIR/config/core.yaml" "$PWD/core.yaml" >/dev/null 2>&1 || true
export FABRIC_CFG_PATH="$PWD"

CHANNEL="${FABRIC_CHANNEL:-roadwatch-india}"
CC_NAME="${FABRIC_CHAINCODE:-complaint-anchor}"
CC_VERSION="${FABRIC_CC_VERSION:-0.0.1}"
CC_SEQUENCE="${FABRIC_CC_SEQUENCE:-1}"
CC_LANG="${FABRIC_CC_LANG:-golang}"
CC_SRC_PATH="${FABRIC_CC_SRC_PATH:-$ROOT_DIR/fabric/chaincode/$CC_NAME}"

ORDERER_ENDPOINT="${FABRIC_ORDERER_ENDPOINT:-localhost:7050}"
ORDERER_HOST_OVERRIDE="${FABRIC_ORDERER_HOST_OVERRIDE:-orderer1.orderer.roadwatch.com}"
ORDERER_CA="$PWD/organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem"

NHAI_PEER_ADDR="${FABRIC_NHAI_PEER_ENDPOINT:-localhost:7051}"
NHAI_PEER_TLS_CA="$PWD/organizations/peerOrganizations/nhai.roadwatch.com/peers/peer0.nhai.roadwatch.com/tls/ca.crt"

ROADWATCH_PEER_ADDR="${FABRIC_ROADWATCH_PEER_ENDPOINT:-localhost:9051}"
ROADWATCH_PEER_TLS_CA="$PWD/organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt"

setPeerContext() {
  local ORG="$1"
  case "$ORG" in
    nhai)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=NHAIMSP
      export CORE_PEER_ADDRESS="$NHAI_PEER_ADDR"
      export CORE_PEER_TLS_ROOTCERT_FILE="$NHAI_PEER_TLS_CA"
      export CORE_PEER_MSPCONFIGPATH="$PWD/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp"
      ;;
    roadwatch)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=RoadWatchMSP
      export CORE_PEER_ADDRESS="$ROADWATCH_PEER_ADDR"
      export CORE_PEER_TLS_ROOTCERT_FILE="$ROADWATCH_PEER_TLS_CA"
      export CORE_PEER_MSPCONFIGPATH="$PWD/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp"
      ;;
    *)
      echo "Unknown org for peer context: $ORG" >&2
      exit 1
      ;;
  esac
}

requireFile() {
  local PATHNAME="$1"
  if [ ! -f "$PATHNAME" ]; then
    echo "Missing required file: $PATHNAME" >&2
    exit 1
  fi
}

requireDir() {
  local PATHNAME="$1"
  if [ ! -d "$PATHNAME" ]; then
    echo "Missing required directory: $PATHNAME" >&2
    exit 1
  fi
}

requireDir "$CC_SRC_PATH"
requireFile "$ORDERER_CA"
requireFile "$NHAI_PEER_TLS_CA"
requireFile "$ROADWATCH_PEER_TLS_CA"

alreadyCommitted() {
  # Returns 0 if the given name/version/sequence is already committed on the channel.
  setPeerContext nhai
  local out
  if ! out="$(peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME" 2>/dev/null)"; then
    return 1
  fi
  echo "$out" | grep -q "Version: ${CC_VERSION}, Sequence: ${CC_SEQUENCE}"
}

PKG_DIR="$PWD/chaincode-packages"
mkdir -p "$PKG_DIR"
PKG_FILE="$PKG_DIR/${CC_NAME}_${CC_VERSION}.tar.gz"
LABEL="${CC_NAME}_${CC_VERSION}"

echo "==> Packaging chaincode: name=$CC_NAME version=$CC_VERSION sequence=$CC_SEQUENCE channel=$CHANNEL"
peer lifecycle chaincode package "$PKG_FILE" \
  --path "$CC_SRC_PATH" \
  --lang "$CC_LANG" \
  --label "$LABEL"

PACKAGE_ID="$(peer lifecycle chaincode calculatepackageid "$PKG_FILE")"
echo "==> Package ID: $PACKAGE_ID"

if alreadyCommitted; then
  echo "==> Chaincode already committed (version=$CC_VERSION sequence=$CC_SEQUENCE); skipping deploy"
  echo "    To redeploy, bump FABRIC_CC_VERSION and/or FABRIC_CC_SEQUENCE"
  exit 0
fi

installOnOrg() {
  local ORG="$1"
  local PEER_ADDR="$2"
  echo "==> Installing on ${ORG} peer (${PEER_ADDR})"
  setPeerContext "$ORG"

  # Fabric returns status 500 if already installed; treat that as success.
  local out
  if out="$(peer lifecycle chaincode install "$PKG_FILE" 2>&1)"; then
    echo "$out"
    return 0
  fi

  if echo "$out" | grep -qi "already successfully installed"; then
    echo "==> Already installed on ${ORG}; continuing"
    return 0
  fi

  echo "$out" >&2
  return 1
}

installOnOrg nhai "$NHAI_PEER_ADDR"
installOnOrg roadwatch "$ROADWATCH_PEER_ADDR"

approveForOrg() {
  local ORG="$1"
  echo "==> Approving for org: $ORG"
  setPeerContext "$ORG"

  peer lifecycle chaincode approveformyorg \
    -o "$ORDERER_ENDPOINT" \
    --ordererTLSHostnameOverride "$ORDERER_HOST_OVERRIDE" \
    --channelID "$CHANNEL" \
    --name "$CC_NAME" \
    --version "$CC_VERSION" \
    --package-id "$PACKAGE_ID" \
    --sequence "$CC_SEQUENCE" \
    --tls \
    --cafile "$ORDERER_CA"
}

approveForOrg nhai
approveForOrg roadwatch

echo "==> Checking commit readiness"
setPeerContext nhai
peer lifecycle chaincode checkcommitreadiness \
  --channelID "$CHANNEL" \
  --name "$CC_NAME" \
  --version "$CC_VERSION" \
  --sequence "$CC_SEQUENCE" \
  --output json

echo "==> Committing definition"
setPeerContext nhai
peer lifecycle chaincode commit \
  -o "$ORDERER_ENDPOINT" \
  --ordererTLSHostnameOverride "$ORDERER_HOST_OVERRIDE" \
  --channelID "$CHANNEL" \
  --name "$CC_NAME" \
  --version "$CC_VERSION" \
  --sequence "$CC_SEQUENCE" \
  --tls \
  --cafile "$ORDERER_CA" \
  --peerAddresses "$NHAI_PEER_ADDR" \
  --tlsRootCertFiles "$NHAI_PEER_TLS_CA" \
  --peerAddresses "$ROADWATCH_PEER_ADDR" \
  --tlsRootCertFiles "$ROADWATCH_PEER_TLS_CA"

echo "==> Querying committed definition"
setPeerContext nhai
peer lifecycle chaincode querycommitted \
  --channelID "$CHANNEL" \
  --name "$CC_NAME"

if [ "${FABRIC_CC_INVOKE_INIT_LEDGER:-0}" = "1" ]; then
  echo "==> Invoking InitLedger (FABRIC_CC_INVOKE_INIT_LEDGER=1)"
  # This is a regular transaction function in this repo; it is NOT lifecycle init-required.
  # We still target both peers so endorsement policy is satisfied.
  setPeerContext roadwatch
  peer chaincode invoke \
    -o "$ORDERER_ENDPOINT" \
    --ordererTLSHostnameOverride "$ORDERER_HOST_OVERRIDE" \
    --tls \
    --cafile "$ORDERER_CA" \
    -C "$CHANNEL" \
    -n "$CC_NAME" \
    --peerAddresses "$NHAI_PEER_ADDR" \
    --tlsRootCertFiles "$NHAI_PEER_TLS_CA" \
    --peerAddresses "$ROADWATCH_PEER_ADDR" \
    --tlsRootCertFiles "$ROADWATCH_PEER_TLS_CA" \
    -c '{"Args":["InitLedger"]}' \
    --waitForEvent
fi

echo "==> Chaincode deployed: $CC_NAME on channel $CHANNEL"
