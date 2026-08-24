#!/usr/bin/env bash
# ops/dev/setup.sh — Bootstrap a fresh clone on Linux/macOS (Arch, Ubuntu, etc.)
#
# Usage:
#   ./ops/dev/setup.sh
#   ./ops/dev/setup.sh --skip-install
#   ./ops/dev/setup.sh --kubernetes-only
#   pnpm setup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ORIGINAL_ARGS=("$@")
SKIP_INSTALL=0
KUBERNETES_ONLY=0
MISSING_TOOLS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install|-SkipInstall) SKIP_INSTALL=1 ;;
    --kubernetes-only|-KubernetesOnly) KUBERNETES_ONLY=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: setup.sh [--skip-install] [--kubernetes-only]

  --skip-install       Skip pnpm install
  --kubernetes-only    Skip local .env / Fabric binary steps
EOF
      exit 0
      ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

# Activate docker group for this session if needed (Arch/Linux after usermod)
ensure_docker_group "${ORIGINAL_ARGS[@]}"

PKG_HINT="$(detect_pkg_hint)"

# ── 1. Prerequisites ────────────────────────────────────────────────────────
step "1. Prerequisites"

if assert_cmd docker "Install Docker Engine + compose plugin ($PKG_HINT docker docker-compose)"; then
  :
else
  MISSING_TOOLS+=(docker)
fi

if docker_ready; then
  ok "Docker daemon running"
else
  warn "Docker daemon not running — start it first (Arch: sudo systemctl enable --now docker)"
fi

assert_cmd kind "optional — https://kind.sigs.k8s.io/" || true
assert_cmd kubectl "optional — $PKG_HINT kubectl" || true
assert_cmd curl "required for Fabric binary download" || MISSING_TOOLS+=(curl)
assert_cmd jq "optional but recommended — $PKG_HINT jq" || true

if have_cmd pnpm; then
  ok "pnpm $(pnpm --version)"
else
  warn "pnpm not found — trying corepack / npm"
  if have_cmd corepack; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@8.10.0 --activate >/dev/null 2>&1 || true
  fi
  if ! have_cmd pnpm && have_cmd npm; then
    npm install -g pnpm@8.10.0 >/dev/null 2>&1 || true
  fi
  if have_cmd pnpm; then
    ok "pnpm installed ($(pnpm --version))"
  else
    MISSING_TOOLS+=(pnpm)
    warn "Install pnpm 8.10.0: npm install -g pnpm@8.10.0"
  fi
fi

# ── 2. Dependencies ─────────────────────────────────────────────────────────
step "2. Node dependencies"

if (( SKIP_INSTALL == 1 )); then
  warn "Skipping pnpm install (--skip-install)"
else
  if ! pnpm install --frozen-lockfile; then
    warn "Frozen lockfile failed — retrying without --frozen-lockfile"
    pnpm install
  fi
  ok "node_modules ready"
fi

# ── 3. Local .env files ─────────────────────────────────────────────────────
if (( KUBERNETES_ONLY == 0 )); then
  step "3. Local .env files from examples"
  copy_env ".env.example" ".env"
  copy_env "apps/gateway-api/.env.example" "apps/gateway-api/.env"
  copy_env "services/scheduler/.env.example" "services/scheduler/.env"
  copy_env "services/webhook-handler/.env.example" "services/webhook-handler/.env"
  copy_env "services/fabric-anchor-consumer/.env.example" "services/fabric-anchor-consumer/.env"
  copy_env "apps/mobile-host/.env.example" "apps/mobile-host/.env"
  copy_env "docker/.env.example" "docker/.env"
  copy_env "fabric/network/.env.example" "fabric/network/.env"
fi

# ── 4. Directories ──────────────────────────────────────────────────────────
step "4. Workspace directories"
for d in .pids logs bin fabric/network/channel-artifacts; do
  mkdir -p "$d"
  ok "$d"
done

if [[ ! -f "fabric/network/.env" ]]; then
  copy_env "fabric/network/.env.example" "fabric/network/.env"
fi

# ── 5. Fabric binaries (native Linux) ───────────────────────────────────────
if (( KUBERNETES_ONLY == 0 )); then
  step "5. Fabric binaries"
  FABRIC_VERSION="2.5.15"
  if [[ -x "$REPO_ROOT/bin/peer" ]]; then
    ok "Fabric binaries in bin/"
  else
    warn "Downloading Fabric $FABRIC_VERSION binaries into bin/ ..."
    mkdir -p "$REPO_ROOT/bin"
    tmpdir="$(mktemp -d)"
    (
      cd "$tmpdir"
      curl -fsSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh
      chmod +x install-fabric.sh
      ./install-fabric.sh --fabric-version "$FABRIC_VERSION" binary
      cp -a bin/. "$REPO_ROOT/bin/"
    ) && ok "Fabric binaries installed" || warn "Fabric binary install failed — retry later with fabric:start"
    rm -rf "$tmpdir"
  fi

  step "6. Fabric chaincode dependencies"
  if have_cmd npm; then
    shopt -s nullglob
    for pkg in fabric/chaincode/*/package.json; do
      dir="$(dirname "$pkg")"
      echo "    npm install in $dir"
      npm install --prefix "$dir" --prefer-offline >/dev/null 2>&1 || warn "npm install failed in $dir"
    done
    shopt -u nullglob
    ok "Chaincode dependencies installed"
  else
    warn "npm not found — skipping chaincode npm install"
  fi
fi

echo
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}  Setup complete${NC}"
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "  Next:"
echo "    Local:       pnpm start:all"
echo "                 ./ops/dev/start-all.sh"
echo "    Kubernetes:  ./ops/dev/start-all.sh --kubernetes"
echo

if (( ${#MISSING_TOOLS[@]} > 0 )); then
  warn "Missing required tools: ${MISSING_TOOLS[*]}"
  exit 1
fi
