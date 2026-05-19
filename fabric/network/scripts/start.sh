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

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Prefer repo-local Fabric binaries if present.
if [ -d "$ROOT_DIR/bin" ]; then
  export PATH="$ROOT_DIR/bin:$PATH"
fi

DOCKER_COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
fi

# peer reads core.yaml from FABRIC_CFG_PATH; core.yaml expects organizations/* relative to it.
cp -f "$ROOT_DIR/config/core.yaml" "$PWD/core.yaml"
export FABRIC_CFG_PATH="$PWD"

setPeerContext() {
  local ORG="$1"
  case "$ORG" in
    nhai)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=NHAIMSP
      export CORE_PEER_ADDRESS=localhost:7051
      export CORE_PEER_TLS_ROOTCERT_FILE="$PWD/organizations/peerOrganizations/nhai.roadwatch.com/peers/peer0.nhai.roadwatch.com/tls/ca.crt"
      export CORE_PEER_MSPCONFIGPATH="$PWD/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp"
      ;;
    roadwatch)
      export CORE_PEER_TLS_ENABLED=true
      export CORE_PEER_LOCALMSPID=RoadWatchMSP
      export CORE_PEER_ADDRESS=localhost:9051
      export CORE_PEER_TLS_ROOTCERT_FILE="$PWD/organizations/peerOrganizations/roadwatch.roadwatch.com/peers/peer0.roadwatch.roadwatch.com/tls/ca.crt"
      export CORE_PEER_MSPCONFIGPATH="$PWD/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp"
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
  if [ ! -d "$PWD/organizations" ]; then
    echo "==> Organizations directory missing: generating crypto material"
    cryptogen generate \
      --config=../config/crypto-config.yaml \
      --output=organizations
  else
    echo "==> Found existing organizations directory - skipping crypto generation"
  fi

fi

NHAI_ADMIN_CERT="$(resolveSignCert "$PWD/organizations/peerOrganizations/nhai.roadwatch.com/users/Admin@nhai.roadwatch.com/msp/signcerts" "NHAI admin")"
ROADWATCH_ADMIN_CERT="$(resolveSignCert "$PWD/organizations/peerOrganizations/roadwatch.roadwatch.com/users/Admin@roadwatch.roadwatch.com/msp/signcerts" "RoadWatch admin")"
waitForCertificateValidity "$NHAI_ADMIN_CERT" "NHAI admin"
waitForCertificateValidity "$ROADWATCH_ADMIN_CERT" "RoadWatch admin"

if [ "$RESET" = true ] || [ ! -f channel-artifacts/roadwatch-india.tx ] || [ ! -f channel-artifacts/genesis.block ]; then
  echo "==> Generating channel artifacts"
  configtxgen \
    -profile RoadWatchOrdererGenesis \
    -channelID system-channel \
    -outputBlock channel-artifacts/genesis.block \
    -configPath ../config

  configtxgen \
    -profile RoadWatchIndiaChannel \
    -outputCreateChannelTx channel-artifacts/roadwatch-india.tx \
    -channelID roadwatch-india \
    -configPath ../config
else
  echo "==> Channel artifacts already exist - skipping generation"
fi

echo "==> Starting docker containers"
"${DOCKER_COMPOSE[@]}" -f docker/docker-compose.yaml up -d

waitForPort localhost 7050 "orderer"
waitForPort localhost 7051 "peer0.nhai"
waitForPort localhost 9051 "peer0.roadwatch"

echo "==> Creating channel"
setPeerContext nhai
retryCommand "peer channel create" peer channel create \
  -o localhost:7050 \
  -c roadwatch-india \
  -f channel-artifacts/roadwatch-india.tx \
  --tls \
  --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem

echo "==> Joining NHAI peer to channel"
setPeerContext nhai
peer channel join -b roadwatch-india.block

echo "==> Joining RoadWatch peer to channel"
setPeerContext roadwatch
peer channel join -b roadwatch-india.block

echo "==> Setting anchor peers"
configtxgen \
  -profile RoadWatchIndiaChannel \
  -outputAnchorPeersUpdate channel-artifacts/NHAIMSPAnchors.tx \
  -channelID roadwatch-india \
  -asOrg NHAIMSP \
  -configPath ../config

configtxgen \
  -profile RoadWatchIndiaChannel \
  -outputAnchorPeersUpdate channel-artifacts/RoadWatchMSPAnchors.tx \
  -channelID roadwatch-india \
  -asOrg RoadWatchMSP \
  -configPath ../config

setPeerContext nhai
peer channel update \
  -o localhost:7050 \
  -c roadwatch-india \
  -f channel-artifacts/NHAIMSPAnchors.tx \
  --tls \
  --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem

setPeerContext roadwatch
peer channel update \
  -o localhost:7050 \
  -c roadwatch-india \
  -f channel-artifacts/RoadWatchMSPAnchors.tx \
  --tls \
  --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem

echo "==> Deploying chaincode"
if [ -x "./scripts/deploy-chaincode.sh" ]; then
  ./scripts/deploy-chaincode.sh
else
  echo "==> Skipping chaincode deploy (scripts/deploy-chaincode.sh not found)"
fi

echo "==> Network ready"
peer channel list
