#!/bin/bash
# ops/deploy/fabric-start.sh

set -e

# Usage: ./fabric-start.sh [--reset]
# By default preserves existing artifacts. Pass --reset for full teardown.

RESET=false
if [ "$1" = "--reset" ] || [ "$1" = "-r" ]; then
  RESET=true
fi

# Resolve repo root (ops/deploy/ → repo root is two levels up)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NETWORK_DIR="$REPO_ROOT/fabric/network"
ROOT_DIR="$REPO_ROOT"

source "$SCRIPT_DIR/fabric-env.sh"

CHANNEL="${FABRIC_CHANNEL:-$FABRIC_CHANNEL_NAME}"

# Determine required fabric peer version from docker-compose (fallback to 2.5.15)
REQUIRED_FABRIC_VERSION="$(sed -n '1,120p' "$NETWORK_DIR/docker/docker-compose.yaml" | grep -m1 'image:.*hyperledger/fabric-peer' | sed 's/.*://; s/[^0-9.]//g' || true)"
if [ -z "$REQUIRED_FABRIC_VERSION" ]; then
  REQUIRED_FABRIC_VERSION="2.5.15"
fi

# Prefer repo-local Fabric binaries if present. If local `peer` exists but
# mismatches the required runtime version, try to download matching binaries
# into `ROOT_DIR/bin` so CLI and containers are in parity and lifecycle
# operations don't hit ReadSet/WriteSet version errors.
install_matching_binaries() {
  if ! command -v peer >/dev/null 2>&1; then
    return 1
  fi

  LOCAL_VER_RAW=$(peer version 2>/dev/null | sed -ne 's/^ Version: //p' || true)
  LOCAL_VER="${LOCAL_VER_RAW#v}"
  if [ -z "$LOCAL_VER" ] || [ "$LOCAL_VER" = "$REQUIRED_FABRIC_VERSION" ]; then
    return 0
  fi

  echo "==> Detected local peer version ${LOCAL_VER}, required ${REQUIRED_FABRIC_VERSION}. Installing matching binaries into $ROOT_DIR/bin"
  TMPDIR=$(mktemp -d)
  (cd "$TMPDIR" && \
    curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh && \
    chmod +x install-fabric.sh && \
    ./install-fabric.sh binary "$REQUIRED_FABRIC_VERSION") || {
    echo "WARN: failed to download/install Fabric binaries in $TMPDIR; continuing with existing peer binary" >&2
    rm -rf "$TMPDIR"
    return 1
  }

  mkdir -p "$ROOT_DIR/bin"
  if [ -d "$TMPDIR/bin" ]; then
    cp -a "$TMPDIR/bin/." "$ROOT_DIR/bin/" || true
    rm -rf "$TMPDIR"
    export PATH="$ROOT_DIR/bin:$PATH"
    echo "==> Installed matching Fabric binaries to $ROOT_DIR/bin"
    return 0
  else
    echo "WARN: install script did not produce bin/ directory; leaving local binaries untouched" >&2
    rm -rf "$TMPDIR"
    return 1
  fi
}

if [ -d "$ROOT_DIR/bin" ]; then
  export PATH="$ROOT_DIR/bin:$PATH"
fi

# If local peer exists but doesn't match required version, attempt to install
# matching binaries to repo `bin/` for parity.
install_matching_binaries || true

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

waitForChannelReadiness() {
  local ORG="$1"
  local LABEL="$2"
  local ATTEMPTS=20
  local SLEEP_SECONDS=3

  echo "==> Waiting for ${LABEL} channel RPC readiness"
  setPeerContext "$ORG"

  for i in $(seq 1 "$ATTEMPTS"); do
    if peer channel list >/dev/null 2>&1; then
      echo "==> ${LABEL} channel RPC is ready"
      return 0
    fi

    echo "==> ${LABEL} channel RPC attempt ${i}/${ATTEMPTS} not ready yet; retrying..."
    sleep "$SLEEP_SECONDS"
  done

  echo "ERROR: Timed out waiting for ${LABEL} channel RPC readiness" >&2
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

  retryCommand "peer channel fetch config" fetchChannelConfig "$CURRENT_CONFIG_JSON"

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

# Ensure channel artifacts reflect current config templates. If the
# config files changed since artifacts were generated, re-generate to
# avoid using stale config blocks which can cause version mismatches.
CONFIG_HASH_FILE="channel-artifacts/.configtx_hash"
CUR_HASH=$(sha1sum ../config/configtx.yaml | awk '{print $1}')
PREV_HASH=""
if [ -f "$CONFIG_HASH_FILE" ]; then
  PREV_HASH=$(cat "$CONFIG_HASH_FILE")
fi
if [ "$CUR_HASH" != "$PREV_HASH" ]; then
  echo "==> Detected configtx.yaml change (or missing hash). Regenerating channel artifacts to avoid stale config blocks"
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
  echo "$CUR_HASH" > "$CONFIG_HASH_FILE"
fi

echo "==> Ensuring Docker network '${FABRIC_NETWORK_NAME:-roadwatch_fabric_net}' exists"
docker network inspect "${FABRIC_NETWORK_NAME:-roadwatch_fabric_net}" >/dev/null 2>&1 \
  || docker network create "${FABRIC_NETWORK_NAME:-roadwatch_fabric_net}"

echo "==> Starting docker containers"
# If FABRIC_LEDGER_STATE_DB is set to CouchDB, enable the couchdb compose profile
PROFILE_ARGS=()
if [ "${FABRIC_LEDGER_STATE_DB:-goleveldb}" = "CouchDB" ]; then
  PROFILE_ARGS+=(--profile couchdb)
  echo "==> Enabling Docker Compose profile: couchdb"
fi
"${DOCKER_COMPOSE[@]}" -f docker/docker-compose.yaml "${PROFILE_ARGS[@]}" up -d

waitForPort localhost "$FABRIC_ORDERER_PORT" "orderer"
waitForPort localhost "$FABRIC_NHAI_PEER_PORT" "peer0.nhai"
waitForPort localhost "$FABRIC_ROADWATCH_PEER_PORT" "peer0.roadwatch"
waitForChannelReadiness nhai "NHAI peer"
waitForChannelReadiness roadwatch "RoadWatch peer"

echo "==> Creating channel"
setPeerContext nhai

if retryCommand "peer channel fetch 0" peer channel fetch 0 ${CHANNEL}.block \
  -o localhost:$FABRIC_ORDERER_PORT \
  -c "$CHANNEL" \
  --tls \
  --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem; then
  echo "==> Channel $CHANNEL already exists; reusing fetched genesis block"
else
  if [ -f "${CHANNEL}.block" ]; then
    echo "==> Channel $CHANNEL block already exists locally; reusing ${CHANNEL}.block"
  else
    retryCommand "peer channel create" peer channel create \
      -o localhost:$FABRIC_ORDERER_PORT \
      -c "$CHANNEL" \
      -f channel-artifacts/${CHANNEL}.tx \
      --tls \
      --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem
  fi
fi

echo "==> Joining NHAI peer to channel"
setPeerContext nhai
if peer channel list 2>/dev/null | grep -q "${CHANNEL}"; then
  echo "==> NHAI peer already joined to channel ${CHANNEL}; skipping"
else
  retryCommand "peer channel join (NHAI)" peer channel join -b ${CHANNEL}.block || {
    if peer channel list 2>/dev/null | grep -q "${CHANNEL}"; then
      echo "==> NHAI peer already joined to channel ${CHANNEL}; skipping"
    else
      return 1
    fi
  }
fi

echo "==> Joining RoadWatch peer to channel"
setPeerContext roadwatch
if peer channel list 2>/dev/null | grep -q "${CHANNEL}"; then
  echo "==> RoadWatch peer already joined to channel ${CHANNEL}; skipping"
else
  retryCommand "peer channel join (RoadWatch)" peer channel join -b ${CHANNEL}.block || {
    if peer channel list 2>/dev/null | grep -q "${CHANNEL}"; then
      echo "==> RoadWatch peer already joined to channel ${CHANNEL}; skipping"
    else
      return 1
    fi
  }
fi

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
