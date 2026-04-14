#!/bin/bash
# fabric/network/scripts/start.sh

set -e

echo "==> Cleaning previous state"
docker-compose -f docker/docker-compose.yaml down --volumes --remove-orphans

echo "==> Generating crypto material"
cryptogen generate \
  --config=../config/crypto-config.yaml \
  --output=organizations

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

echo "==> Starting docker containers"
docker-compose -f docker/docker-compose.yaml up -d

echo "==> Waiting for peers to start"
sleep 5

echo "==> Creating channel"
peer channel create \
  -o orderer1.orderer.roadwatch.com:7050 \
  -c roadwatch-india \
  -f channel-artifacts/roadwatch-india.tx \
  --tls \
  --cafile organizations/ordererOrganizations/orderer.roadwatch.com/orderers/orderer1.orderer.roadwatch.com/msp/tlscacerts/tlsca.orderer.roadwatch.com-cert.pem

echo "==> Joining NHAI peer to channel"
export CORE_PEER_LOCALMSPID=NHAIMSP
# ... env vars
peer channel join -b roadwatch-india.block

echo "==> Joining RoadWatch peer to channel"
export CORE_PEER_LOCALMSPID=RoadWatchMSP
# ... env vars
peer channel join -b roadwatch-india.block

echo "==> Deploying chaincode"
./scripts/deploy-chaincode.sh

echo "==> Network ready"
peer channel list
