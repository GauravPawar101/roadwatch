#!/bin/bash
# ops/deploy/fabric-env.sh
# Resolves the repo root and sources fabric/network/.env.
# Sourced by fabric-start.sh and fabric-deploy-chaincode.sh.

# REPO_ROOT is the roadwatch/ repo root (two levels up from ops/deploy/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NETWORK_DIR="$REPO_ROOT/fabric/network"

set -a
source "$NETWORK_DIR/.env"
set +a

export FABRIC_CFG_PATH="${FABRIC_CFG_PATH:-$NETWORK_DIR}"
export REPO_ROOT
export NETWORK_DIR
