#!/bin/bash
# fabric/network/scripts/start.sh

set -e

# Usage: ./start.sh [--reset]
# By default this script will start the fabric network and preserve any
# previously-generated artifacts and containers. Pass `--reset` to perform
# a full teardown (down --volumes) and regenerate artifacts from scratch.

RESET=false
if [ "$1" = "--reset" ] || [ "$1" = "-r" ]; then
  RESET=true
fi

NETWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$NETWORK_DIR/../.." && pwd)"

source "$NETWORK_DIR/scripts/env.sh"

CHANNEL="${FABRIC_CHANNEL:-$FABRIC_CHANNEL_NAME}"

# Prefer repo-local Fabric binaries if present.
if [ -d "$ROOT_DIR/bin" ]; then
  export PATH="$ROOT_DIR/bin:$PATH"
fi

DOCKER_COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
fi
DOCKER_COMPOSE+=(-p "$FABRIC_COMPOSE_PROJECT_NAME")

# Resolve the Docker daemon socket before starting any containers.
# On Docker Desktop with WSL integration, the shared socket can be mounted
# outside the default /var/run path.
if [ -z "${DOCKER_HOST:-}" ]; then
  if [ -S /var/run/docker.sock ]; then
    export DOCKER_HOST=unix:///var/run/docker.sock
  elif [ -S /mnt/wsl/shared-docker/docker.sock ]; then
    export DOCKER_HOST=unix:///mnt/wsl/shared-docker/docker.sock
  else
    echo "ERROR: Docker daemon is not reachable from this WSL distro."
    echo "       Enable Docker Desktop WSL integration for Ubuntu or set DOCKER_HOST to a valid unix socket."
    exit 1
  fi
fi

# peer reads core.yaml from FABRIC_CFG_PATH; core.yaml expects organizations/* relative to it.
cp -f "$ROOT_DIR/config/core.yaml" "$NETWORK_DIR/core.yaml"
export FABRIC_CFG_PATH="$NETWORK_DIR"

ORDERER_CA="$NETWORK_DIR/organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem"

setPeerContext() {
  local ORG="$1"
  case "$ORG" in
    nhai)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=NHAIMSP
      export CORE_PEER_ADDRESS=localhost:$FABRIC_NHAI_PEER_PORT
      export CORE_PEER_TLS_ROOTCERT_FILE="$NETWORK_DIR/organizations/peerOrganizations/nhai.roadwatch.com/peers/peer0.nhai.roadwatch.com/tls/ca.crt"
      export CORE_PEER_MSPCONFIGPATH="$NETWORK_DIR/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp"
      ;;
    roadwatch)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=RoadWatchMSP
      export CORE_PEER_ADDRESS=localhost:$FABRIC_ROADWATCH_PEER_PORT
      export CORE_PEER_TLS_ROOTCERT_FILE="$NETWORK_DIR/organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt"
      export CORE_PEER_MSPCONFIGPATH="$NETWORK_DIR/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp"
      ;;
    *)
      echo "Unknown org for peer context: $ORG" >&2
      exit 1
      ;;
  esac
}

waitForPort() {
  local HOST="$1"
  local PORT="$2"
  local NAME="$3"
  local ATTEMPTS=30
  local SLEEP_SECONDS=2

  echo "==> Waiting for ${NAME} (${HOST}:${PORT})"
  for i in $(seq 1 "$ATTEMPTS"); do
    if (echo >"/dev/tcp/${HOST}/${PORT}") >/dev/null 2>&1; then
      echo "==> ${NAME} is up"
      return 0
    fi
    sleep "$SLEEP_SECONDS"
  done

  echo "ERROR: Timed out waiting for ${NAME} (${HOST}:${PORT})" >&2
  exit 1
}

retryCommand() {
  local LABEL="$1"
  shift
  local ATTEMPTS=20
  local SLEEP_SECONDS=3

  for i in $(seq 1 "$ATTEMPTS"); do
    if "$@"; then
      return 0
    fi

    echo "==> ${LABEL} attempt ${i}/${ATTEMPTS} failed; retrying..."
    sleep "$SLEEP_SECONDS"
  done

  echo "ERROR: ${LABEL} failed after ${ATTEMPTS} attempts" >&2
  return 1
}

fetchChannelConfig() {
  local OUTPUT_JSON="$1"

  peer channel fetch config channel-artifacts/config_block.pb \
    -o localhost:$FABRIC_ORDERER_PORT \
    -c "$CHANNEL" \
    --tls \
    --cafile "$ORDERER_CA"

  configtxlator proto_decode \
    --input channel-artifacts/config_block.pb \
    --type common.Block \
    | jq .data.data[0].payload.data.config > "$OUTPUT_JSON"
}

createAnchorPeerUpdate() {
  local ORG="$1"
  local ANCHOR_HOST="$2"
  local ANCHOR_PORT="$3"
  local OUTPUT_TX="$4"
  local CURRENT_CONFIG_JSON="channel-artifacts/${CORE_PEER_LOCALMSPID}config.json"
  local MODIFIED_CONFIG_JSON="channel-artifacts/${CORE_PEER_LOCALMSPID}modified_config.json"

  fetchChannelConfig "$CURRENT_CONFIG_JSON"

  jq --arg mspid "$CORE_PEER_LOCALMSPID" --arg host "$ANCHOR_HOST" --argjson port "$ANCHOR_PORT" '
    .channel_group.groups.Application.groups[$mspid].values += {
      "AnchorPeers": {
        "mod_policy": "Admins",
        "value": {"anchor_peers": [{"host": $host, "port": $port}]},
        "version": "0"
      }
    }
  ' "$CURRENT_CONFIG_JSON" > "$MODIFIED_CONFIG_JSON"

  configtxlator proto_encode --input "$CURRENT_CONFIG_JSON" --type common.Config --output channel-artifacts/original_config.pb
  configtxlator proto_encode --input "$MODIFIED_CONFIG_JSON" --type common.Config --output channel-artifacts/modified_config.pb

  if ! configtxlator compute_update \
    --channel_id "$CHANNEL" \
    --original channel-artifacts/original_config.pb \
    --updated channel-artifacts/modified_config.pb \
    --output channel-artifacts/config_update.pb; then
    echo "==> Anchor peer already set for ${CORE_PEER_LOCALMSPID}; skipping"
    return 1
  fi

  configtxlator proto_decode --input channel-artifacts/config_update.pb --type common.ConfigUpdate --output channel-artifacts/config_update.json
  jq -n --arg channel "$CHANNEL" --argjson config_update "$(cat channel-artifacts/config_update.json)" '{payload:{header:{channel_header:{channel_id:$channel,type:2}},data:{config_update:$config_update}}}' > channel-artifacts/config_update_in_envelope.json
  configtxlator proto_encode --input channel-artifacts/config_update_in_envelope.json --type common.Envelope --output "$OUTPUT_TX"
}

setAnchorPeerForOrg() {
  local ORG="$1"
  local ANCHOR_HOST="$2"
  local ANCHOR_PORT="$3"

  setPeerContext "$ORG"

  local ANCHOR_UPDATE_TX="channel-artifacts/${CORE_PEER_LOCALMSPID}anchors.tx"

  echo "==> Updating anchor peer for ${CORE_PEER_LOCALMSPID} to ${ANCHOR_HOST}:${ANCHOR_PORT}"

  if ! createAnchorPeerUpdate "$ORG" "$ANCHOR_HOST" "$ANCHOR_PORT" "$ANCHOR_UPDATE_TX"; then
    return 0
  fi

  # Attempt to apply the channel update. If the orderer rejects the update
  # due to a ReadSet/WriteSet version mismatch (concurrent channel updates),
  # refetch the channel config, recompute the update and retry a few times.
  local ATTEMPT=1
  local MAX_ATTEMPTS=3
  while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    if peer channel update \
      -o localhost:$FABRIC_ORDERER_PORT \
      -c "$CHANNEL" \
      -f "$ANCHOR_UPDATE_TX" \
      --tls \
      --cafile "$ORDERER_CA"; then
      echo "==> Anchor peer set for ${CORE_PEER_LOCALMSPID} on channel ${CHANNEL} to ${ANCHOR_HOST}:${ANCHOR_PORT}"
      break
    fi

    echo "==> peer channel update attempt ${ATTEMPT} failed; refetching config and retrying..."
    ATTEMPT=$((ATTEMPT + 1))

    if [ $ATTEMPT -le $MAX_ATTEMPTS ]; then
      # Re-fetch the latest channel config and recompute the update
      if ! createAnchorPeerUpdate "$ORG" "$ANCHOR_HOST" "$ANCHOR_PORT" "$ANCHOR_UPDATE_TX"; then
        # If recompute indicates the anchor peer is already set, stop retrying
        break
      fi
    else
      echo "ERROR: Failed to set anchor peer for ${CORE_PEER_LOCALMSPID} after ${MAX_ATTEMPTS} attempts" >&2
      return 1
    fi
  done
}

waitForCertificateValidity() {
  local CERT_PATH="$1"
  local LABEL="$2"
  local ATTEMPTS=30
  local SLEEP_SECONDS=2

  if [ ! -f "$CERT_PATH" ]; then
    echo "ERROR: Missing certificate for ${LABEL}: ${CERT_PATH}" >&2
    exit 1
  fi

  for i in $(seq 1 "$ATTEMPTS"); do
    local NOT_BEFORE
    local NOT_BEFORE_EPOCH
    local NOW_EPOCH

    NOT_BEFORE="$(openssl x509 -in "$CERT_PATH" -noout -startdate | cut -d= -f2)"
    NOT_BEFORE_EPOCH="$(date -u -d "$NOT_BEFORE" +%s)"
    NOW_EPOCH="$(date -u +%s)"

    if [ "$NOW_EPOCH" -ge "$NOT_BEFORE_EPOCH" ]; then
      echo "==> ${LABEL} certificate is valid"
      return 0
    fi

    echo "==> Waiting for ${LABEL} certificate to become valid (${NOT_BEFORE})"
    sleep "$SLEEP_SECONDS"
  done

  echo "ERROR: ${LABEL} certificate is still not valid after waiting" >&2
  return 1
}

resolveSignCert() {
  local SIGNCERT_DIR="$1"
  local LABEL="$2"
  local CERT_PATH

  CERT_PATH="$(find "$SIGNCERT_DIR" -maxdepth 1 -type f -name '*.pem' | head -n 1)"
  if [ -z "$CERT_PATH" ]; then
    echo "ERROR: Missing certificate for ${LABEL}: ${SIGNCERT_DIR}" >&2
    exit 1
  fi

  echo "$CERT_PATH"
}

if [ "$RESET" = true ]; then
  echo "==> Reset requested: cleaning previous state"
  "${DOCKER_COMPOSE[@]}" -f docker/docker-compose.yaml down --volumes --remove-orphans

  echo "==> Removing generated artifacts"
  # Previous runs may create root-owned files; delete via a container to avoid permission issues.
  docker run --rm -v "$PWD":/work alpine:3.20 sh -lc \
    "rm -rf /work/organizations && rm -f /work/channel-artifacts/*.block /work/channel-artifacts/*.tx /work/*.block"

  echo "==> Generating crypto material"
  cryptogen generate \
    --config=../config/crypto-config.yaml \
    --output=organizations
else
  echo "==> No reset requested: preserving existing artifacts if present"
  if [ ! -d "$NETWORK_DIR/organizations" ]; then
    echo "==> Organizations directory missing: generating crypto material"
    cryptogen generate \
      --config=../config/crypto-config.yaml \
      --output=organizations
  else
    echo "==> Found existing organizations directory - skipping crypto generation"
  fi

fi

NHAI_ADMIN_CERT="$(resolveSignCert "$NETWORK_DIR/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp/signcerts" "NHAI admin")"
ROADWATCH_ADMIN_CERT="$(resolveSignCert "$NETWORK_DIR/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp/signcerts" "RoadWatch admin")"
waitForCertificateValidity "$NHAI_ADMIN_CERT" "NHAI admin"
waitForCertificateValidity "$ROADWATCH_ADMIN_CERT" "RoadWatch admin"

if [ "$RESET" = true ] || [ ! -f channel-artifacts/${CHANNEL}.tx ] || [ ! -f channel-artifacts/genesis.block ]; then
  echo "==> Generating channel artifacts"
  configtxgen \
    -profile RoadWatchOrdererGenesis \
    -channelID system-channel \
    -outputBlock channel-artifacts/genesis.block \
    -configPath ../config

  configtxgen \
    -profile RoadWatchIndiaChannel \
    -outputCreateChannelTx channel-artifacts/${CHANNEL}.tx \
    -channelID "$CHANNEL" \
    -configPath ../config
else
  echo "==> Channel artifacts already exist - skipping generation"
fi

echo "==> Starting docker containers"
"${DOCKER_COMPOSE[@]}" -f docker/docker-compose.yaml up -d

waitForPort localhost "$FABRIC_ORDERER_PORT" "orderer"
waitForPort localhost "$FABRIC_NHAI_PEER_PORT" "peer0.nhai"
waitForPort localhost "$FABRIC_ROADWATCH_PEER_PORT" "peer0.roadwatch"

echo "==> Creating channel"
setPeerContext nhai

if peer channel fetch 0 ${CHANNEL}.block \
  -o localhost:$FABRIC_ORDERER_PORT \
  -c "$CHANNEL" \
  --tls \
  --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem; then
  echo "==> Channel $CHANNEL already exists; reusing fetched genesis block"
else
  retryCommand "peer channel create" peer channel create \
    -o localhost:$FABRIC_ORDERER_PORT \
    -c "$CHANNEL" \
    -f channel-artifacts/${CHANNEL}.tx \
    --tls \
    --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem
fi

echo "==> Joining NHAI peer to channel"
setPeerContext nhai
peer channel join -b ${CHANNEL}.block

echo "==> Joining RoadWatch peer to channel"
setPeerContext roadwatch
peer channel join -b ${CHANNEL}.block

echo "==> Setting anchor peers"
setAnchorPeerForOrg nhai localhost "$FABRIC_NHAI_PEER_PORT"
setAnchorPeerForOrg roadwatch localhost "$FABRIC_ROADWATCH_PEER_PORT"

echo "==> Deploying chaincode"
if [ -x "./scripts/deploy-chaincode.sh" ]; then
  ./scripts/deploy-chaincode.sh
else
  echo "==> Skipping chaincode deploy (scripts/deploy-chaincode.sh not found)"
fi

echo "==> Network ready"
peer channel list
