#!/usr/bin/env bash
# Convenience wrapper used by teardown docs / Windows parity
exec "$(cd "$(dirname "$0")/../dev" && pwd)/stop-all.sh" "$@"
