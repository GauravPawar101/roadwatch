#!/bin/bash

NETWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

set -a
source "$NETWORK_DIR/.env"
set +a

export FABRIC_CFG_PATH="${FABRIC_CFG_PATH:-$NETWORK_DIR}"