#!/bin/bash
# fabric/network/scripts/deploy-chaincode.sh
#
# Deploys a chaincode to the local RoadWatch Fabric dev network using Fabric v2 lifecycle:
# package -> install -> approve (each org) -> commit.

set -euo pipefail

NETWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$NETWORK_DIR/../.." && pwd)"

source "$NETWORK_DIR/scripts/env.sh"

# Prefer repo-local Fabric binaries if present.
if [ -d "$ROOT_DIR/bin" ]; then
  export PATH="$ROOT_DIR/bin:$PATH"
fi

# Ensure local CLI matches peer runtime version (compose). If a mismatch is
# detected, attempt to fetch matching Fabric binaries into repo `bin/`.
REQUIRED_FABRIC_VERSION="$(sed -n '1,120p' "$NETWORK_DIR/docker/docker-compose.yaml" | grep -m1 'image:.*hyperledger/fabric-peer' | sed 's/.*://; s/[^0-9.]//g' || true)"
if [ -z "$REQUIRED_FABRIC_VERSION" ]; then
  REQUIRED_FABRIC_VERSION="2.5.15"
fi

if command -v peer >/dev/null 2>&1; then
  LOCAL_VER_RAW=$(peer version 2>/dev/null | sed -ne 's/^ Version: //p' || true)
  LOCAL_VER="${LOCAL_VER_RAW#v}"
  if [ -n "$LOCAL_VER" ] && [ "$LOCAL_VER" != "$REQUIRED_FABRIC_VERSION" ]; then
    echo "==> Local peer CLI version ${LOCAL_VER} differs from required ${REQUIRED_FABRIC_VERSION}. Attempting to install matching binaries into $ROOT_DIR/bin"
    TMPDIR=$(mktemp -d)
    (cd "$TMPDIR" && \
      curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh && \
      chmod +x install-fabric.sh && \
      ./install-fabric.sh binary "$REQUIRED_FABRIC_VERSION") || {
      echo "WARN: failed to download/install Fabric binaries; continuing with existing CLI" >&2
      rm -rf "$TMPDIR"
    }

    mkdir -p "$ROOT_DIR/bin"
    if [ -d "$TMPDIR/bin" ]; then
      cp -a "$TMPDIR/bin/." "$ROOT_DIR/bin/" || true
      rm -rf "$TMPDIR"
      export PATH="$ROOT_DIR/bin:$PATH"
      echo "==> Installed matching Fabric binaries to $ROOT_DIR/bin"
    else
      echo "WARN: install script did not produce bin/ directory; leaving local binaries untouched" >&2
      rm -rf "$TMPDIR"
    fi
  fi
fi

ensureFabricImage() {
  local SOURCE_IMAGE="$1"
  local TARGET_IMAGE="$2"

  if docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1; then
    return 0
  fi

  echo "==> Pulling Fabric image: $SOURCE_IMAGE"
  docker pull "$SOURCE_IMAGE"

  if [ "$SOURCE_IMAGE" != "$TARGET_IMAGE" ]; then
    docker tag "$SOURCE_IMAGE" "$TARGET_IMAGE"
  fi
}

ensureFabricChaincodeImages() {
  # Fabric still resolves the chaincode builder/runtime images from the legacy
  # hyperledger/* namespace in core.yaml, so make sure those local tags exist.
  ensureFabricImage "ghcr.io/hyperledger/fabric-ccenv:2.5.15" "hyperledger/fabric-ccenv:2.5.15"
  ensureFabricImage "ghcr.io/hyperledger/fabric-baseos:2.5.15" "hyperledger/fabric-baseos:2.5.15"
}

# peer reads core.yaml from FABRIC_CFG_PATH; core.yaml expects organizations/* relative to it.
cp -f "$ROOT_DIR/config/core.yaml" "$NETWORK_DIR/core.yaml" >/dev/null 2>&1 || true
export FABRIC_CFG_PATH="$NETWORK_DIR"

CHANNEL="${FABRIC_CHANNEL:-$FABRIC_CHANNEL_NAME}"
CC_NAME="${FABRIC_CHAINCODE:-$FABRIC_CHAINCODE_NAME}"
CC_VERSION="${FABRIC_CC_VERSION:-}"
CC_SEQUENCE="${FABRIC_CC_SEQUENCE:-1}"
CC_SRC_PATH="${FABRIC_CC_SRC_PATH:-$ROOT_DIR/fabric/chaincode/$CC_NAME}"
CC_SIGNATURE_POLICY="${FABRIC_CC_SIGNATURE_POLICY:-}"

if [ -z "$CC_VERSION" ] && [ -f "$CC_SRC_PATH/package.json" ]; then
  CC_VERSION="$(jq -r '.version // empty' "$CC_SRC_PATH/package.json")"
fi
if [ -z "$CC_VERSION" ]; then
  CC_VERSION="0.0.1"
fi

if [ -n "${FABRIC_CC_LANG:-}" ]; then
  CC_LANG="$FABRIC_CC_LANG"
elif [ -f "$CC_SRC_PATH/package.json" ]; then
  CC_LANG="node"
else
  CC_LANG="golang"
fi

ORDERER_ENDPOINT="${FABRIC_ORDERER_ENDPOINT:-localhost:$FABRIC_ORDERER_PORT}"
ORDERER_HOST_OVERRIDE="${FABRIC_ORDERER_HOST_OVERRIDE:-orderer1.orderer.roadwatch.com}"
ORDERER_CA="$NETWORK_DIR/organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem"

NHAI_PEER_ADDR="${FABRIC_NHAI_PEER_ENDPOINT:-localhost:$FABRIC_NHAI_PEER_PORT}"
NHAI_PEER_TLS_CA="$NETWORK_DIR/organizations/peerOrganizations/nhai.roadwatch.com/peers/peer0.nhai.roadwatch.com/tls/ca.crt"

ROADWATCH_PEER_ADDR="${FABRIC_ROADWATCH_PEER_ENDPOINT:-localhost:$FABRIC_ROADWATCH_PEER_PORT}"
ROADWATCH_PEER_TLS_CA="$NETWORK_DIR/organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt"

setPeerContext() {
  local ORG="$1"
  case "$ORG" in
    nhai)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=NHAIMSP
      export CORE_PEER_ADDRESS="$NHAI_PEER_ADDR"
      export CORE_PEER_TLS_ROOTCERT_FILE="$NHAI_PEER_TLS_CA"
      export CORE_PEER_MSPCONFIGPATH="$NETWORK_DIR/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp"
      ;;
    roadwatch)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=RoadWatchMSP
      export CORE_PEER_ADDRESS="$ROADWATCH_PEER_ADDR"
      export CORE_PEER_TLS_ROOTCERT_FILE="$ROADWATCH_PEER_TLS_CA"
      export CORE_PEER_MSPCONFIGPATH="$NETWORK_DIR/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp"
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

ensureFabricChaincodeImages

alreadyCommitted() {
  # Returns 0 if the given name/version/sequence is already committed on the channel.
  setPeerContext nhai
  if ! peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

PKG_DIR="$NETWORK_DIR/chaincode-packages"
mkdir -p "$PKG_DIR"
PKG_FILE="$PKG_DIR/${CC_NAME}_${CC_VERSION}.tar.gz"
LABEL="${CC_NAME}_${CC_VERSION}"

echo "==> Packaging chaincode: name=$CC_NAME version=$CC_VERSION sequence=$CC_SEQUENCE channel=$CHANNEL"
peer lifecycle chaincode package "$PKG_FILE" \
  --path "$CC_SRC_PATH" \
  --lang "$CC_LANG" \
  --label "$LABEL"

# Warn if chaincode does not contain CouchDB index files for META-INF (rich query support)
if [ -d "$CC_SRC_PATH/META-INF/statedb/couchdb/indexes" ]; then
  echo "==> Found CouchDB index files in chaincode source"
else
  echo "==> WARNING: No CouchDB index files found under $CC_SRC_PATH/META-INF/statedb/couchdb/indexes"
  echo "    If you rely on Mango rich queries (CouchDB), include index files in META-INF/statedb/couchdb/indexes/"
fi

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

  local APPROVE_POLICY_ARGS=()
  if [ -n "$CC_SIGNATURE_POLICY" ]; then
    APPROVE_POLICY_ARGS+=(--signature-policy "$CC_SIGNATURE_POLICY")
  fi

  peer lifecycle chaincode approveformyorg \
    -o "$ORDERER_ENDPOINT" \
    --ordererTLSHostnameOverride "$ORDERER_HOST_OVERRIDE" \
    --channelID "$CHANNEL" \
    --name "$CC_NAME" \
    --version "$CC_VERSION" \
    --package-id "$PACKAGE_ID" \
    --sequence "$CC_SEQUENCE" \
    "${APPROVE_POLICY_ARGS[@]}" \
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

COMMIT_POLICY_ARGS=()
if [ -n "$CC_SIGNATURE_POLICY" ]; then
  COMMIT_POLICY_ARGS+=(--signature-policy "$CC_SIGNATURE_POLICY")
fi

peer lifecycle chaincode commit \
  -o "$ORDERER_ENDPOINT" \
  --ordererTLSHostnameOverride "$ORDERER_HOST_OVERRIDE" \
  --channelID "$CHANNEL" \
  --name "$CC_NAME" \
  --version "$CC_VERSION" \
  --sequence "$CC_SEQUENCE" \
  "${COMMIT_POLICY_ARGS[@]}" \
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

# Verify the committed definition matches the expected version/sequence
setPeerContext nhai
if ! peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME" 2>/dev/null | grep -q "Version: ${CC_VERSION}, Sequence: ${CC_SEQUENCE}"; then
  echo "ERROR: Committed chaincode definition does not match expected version/sequence: ${CC_NAME} v${CC_VERSION} seq ${CC_SEQUENCE}" >&2
  echo "Please check that the chaincode was committed successfully or bump CC_VERSION/CC_SEQUENCE to redeploy." >&2
  exit 1
fi

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
