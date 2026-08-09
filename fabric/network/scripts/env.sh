#!/bin/bash
# fabric/network/scripts/env.sh
# Sources the fabric/network/.env file for use by all scripts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NETWORK_DIR/../.." && pwd)"

set -a
if [ -f "$NETWORK_DIR/.env" ]; then
  source "$NETWORK_DIR/.env"
else
  echo "ERROR: Missing $NETWORK_DIR/.env — run setup.ps1 first" >&2
  exit 1
fi
set +a

export FABRIC_CFG_PATH="${FABRIC_CFG_PATH:-$NETWORK_DIR}"
export NETWORK_DIR
export REPO_ROOT
