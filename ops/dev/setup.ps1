# scripts/setup.ps1
# One-time setup: install deps, copy .env files, verify prerequisites.
# Run from repo root:  pnpm setup
#
#   pnpm setup              # full setup
#   pnpm setup -SkipInstall # skip pnpm install (already done)

param(
    [switch]$SkipInstall   # skip pnpm install
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..\..   # always run from repo root

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
}

function Write-Ok([string]$msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green  }
function Write-Warn([string]$msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "  ✗ $msg" -ForegroundColor Red    }

function Copy-EnvFile([string]$example, [string]$target) {
    if (Test-Path $target) {
        Write-Ok "$target already exists — skipping"
    } else {
        Copy-Item $example $target
        Write-Ok "Created $target from $example"
    }
}

function Assert-Tool([string]$name, [string]$installHint) {
    if (Get-Command $name -ErrorAction SilentlyContinue) {
        Write-Ok "$name found"
    } else {
        Write-Fail "$name not found — $installHint"
        $script:missingTools += $name
    }
}

$missingTools = @()

# ─────────────────────────────────────────────────────────────
# 1. Prerequisite check
# ─────────────────────────────────────────────────────────────
Write-Step "1. Checking prerequisites"

Assert-Tool "docker"  "Install Docker Desktop: https://docs.docker.com/desktop/windows/"
Assert-Tool "kind"    "winget install Kubernetes.kind"
Assert-Tool "kubectl" "Comes with Docker Desktop, or: winget install Kubernetes.kubectl"
Assert-Tool "wsl"     "Enable WSL2: wsl --install"

# pnpm — install via corepack if missing
if (Get-Command "pnpm" -ErrorAction SilentlyContinue) {
    Write-Ok "pnpm found ($(pnpm --version))"
} else {
    Write-Warn "pnpm not found — installing via corepack"
    corepack enable
    corepack prepare pnpm@8.10.0 --activate
    if (Get-Command "pnpm" -ErrorAction SilentlyContinue) {
        Write-Ok "pnpm installed ($(pnpm --version))"
    } else {
        Write-Fail "pnpm install failed — run: npm install -g pnpm"
        $missingTools += "pnpm"
    }
}

# WSL Ubuntu distro
$wslDistros = wsl --list --quiet 2>$null
if ($wslDistros -match "Ubuntu") {
    Write-Ok "WSL Ubuntu distro found"
} else {
    Write-Warn "WSL Ubuntu distro not found — Fabric scripts run in WSL"
    Write-Warn "Install with: wsl --install -d Ubuntu"
    $missingTools += "wsl-ubuntu"
}

if ($missingTools.Count -gt 0) {
    Write-Host ""
    Write-Warn "Missing tools: $($missingTools -join ', ')"
    Write-Warn "Install them and re-run setup. Continuing anyway..."
}

# ─────────────────────────────────────────────────────────────
# 2. Install node_modules
# ─────────────────────────────────────────────────────────────
Write-Step "2. Installing node modules (pnpm install)"

if ($SkipInstall) {
    Write-Warn "Skipping pnpm install (-SkipInstall)"
} else {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        # lockfile may be out of sync after git pull — retry without frozen
        Write-Warn "Frozen install failed, retrying without --frozen-lockfile"
        pnpm install
    }
    Write-Ok "node_modules installed"
}

# ─────────────────────────────────────────────────────────────
# 3. Copy .env files
# ─────────────────────────────────────────────────────────────
Write-Step "3. Creating .env files from examples"

# Root .env (dev host config — ports for Postgres, Redis, Kafka)
Copy-EnvFile ".env.example"                                    ".env"

# Gateway API
Copy-EnvFile "apps\gateway-api\.env.example"                   "apps\gateway-api\.env"

# Backend API — shares root .env, no separate example needed
# (it reads ../../apps/gateway-api/.env at runtime)

# Services
Copy-EnvFile "services\scheduler\.env.example"                 "services\scheduler\.env"
Copy-EnvFile "services\webhook-handler\.env.example"           "services\webhook-handler\.env"
Copy-EnvFile "services\fabric-anchor-consumer\.env.example"    "services\fabric-anchor-consumer\.env"

# Mobile (optional — only needed for mobile dev)
Copy-EnvFile "apps\mobile-host\.env.example"                   "apps\mobile-host\.env"

# Docker compose env (used when running all services in Docker)
Copy-EnvFile "docker\.env.example"                             "docker\.env"

# Fabric network .env (if not already created by a previous run)
if (-not (Test-Path "fabric\network\.env")) {
    Copy-Item "fabric\network\.env" "fabric\network\.env" -ErrorAction SilentlyContinue
    if (-not (Test-Path "fabric\network\.env")) {
        # It was never committed — the file we created earlier is the source
        Write-Warn "fabric\network\.env not found — it should have been committed or created."
        Write-Warn "Check that fabric\network\.env exists in the repo."
    }
} else {
    Write-Ok "fabric\network\.env already exists — skipping"
}

# ─────────────────────────────────────────────────────────────
# 4. Ensure required directories exist
# ─────────────────────────────────────────────────────────────
Write-Step "4. Creating required directories"

@(
    ".pids",
    "logs",
    "fabric\network\channel-artifacts"
) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
    Write-Ok "$_"
}

# ─────────────────────────────────────────────────────────────
# 5. Fabric binaries in WSL (cryptogen, configtxgen, peer, etc.)
# ─────────────────────────────────────────────────────────────
Write-Step "5. Verifying Fabric binaries in WSL"

# The repo ships bin/ with pre-downloaded Fabric binaries for Linux (used by WSL).
# They are already in bin/ so we just verify WSL can see them.
$FABRIC_VERSION = "2.5.15"
$wslBinCheck = wsl -d Ubuntu -- bash -lc "test -x /mnt/c/Users/$env:USERNAME/Desktop/roadwatch/bin/peer && echo ok || echo missing" 2>$null

if ($wslBinCheck -eq "ok") {
    Write-Ok "Fabric binaries found in bin/ (accessible from WSL)"
} else {
    Write-Warn "Fabric binaries not found in bin/ — downloading into bin/ via WSL"
    $repoPathWsl = "/mnt/c/Users/$env:USERNAME/Desktop/roadwatch"
    wsl -d Ubuntu -- bash -lc @"
set -e
mkdir -p $repoPathWsl/bin
cd /tmp
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version $FABRIC_VERSION binary
cp -a bin/. $repoPathWsl/bin/
echo "Fabric binaries installed"
"@
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Fabric binaries downloaded to bin/"
    } else {
        Write-Warn "Could not download Fabric binaries. Run manually inside WSL:"
        Write-Warn "  curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- --fabric-version $FABRIC_VERSION binary"
    }
}

# ─────────────────────────────────────────────────────────────
# 6. Install Fabric chaincode dependencies in WSL
#    (each chaincode/*/package.json needs npm install)
# ─────────────────────────────────────────────────────────────
Write-Step "6. Installing Fabric chaincode node_modules (via WSL)"

$repoPathWsl = "/mnt/c/Users/$env:USERNAME/Desktop/roadwatch"
$chaincodeInstall = wsl -d Ubuntu -- bash -lc @"
set -e
export PATH="$repoPathWsl/bin:`$PATH"
for dir in $repoPathWsl/fabric/chaincode/*/; do
  if [ -f "`$dir/package.json" ]; then
    echo "==> npm install in `$dir"
    cd "`$dir"
    npm install --prefer-offline 2>&1 | tail -3
  fi
done
echo "done"
"@ 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Ok "Chaincode node_modules installed"
} else {
    Write-Warn "Chaincode npm install had issues (WSL may not be available yet):"
    Write-Warn $chaincodeInstall
    Write-Warn "Run manually: wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Users/$env:USERNAME/Desktop/roadwatch/fabric/chaincode/<name> && npm install'"
}

# ─────────────────────────────────────────────────────────────
# 7. Summary
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  ✅ Setup complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Edit .env files with your secrets (JWT_SECRET, SUPABASE keys, etc.)"
Write-Host "     The files to update are listed below — all others use safe defaults."
Write-Host "       .env"
Write-Host "       apps\gateway-api\.env    ← JWT_SECRET, SUPABASE_*"
Write-Host "       apps\mobile-host\.env    ← GEMINI_API_KEY, SUPABASE_*"
Write-Host ""
Write-Host "  2. Start infrastructure (Postgres, Redis, Kafka):"
Write-Host "       pnpm infra:up" -ForegroundColor Cyan
Write-Host ""
Write-Host "  3. Start Hyperledger Fabric (peers + orderer in Docker via WSL):"
Write-Host "       pnpm fabric:start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  4. Deploy to Kubernetes (kind):"
Write-Host "       pnpm k8s:up" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Or for local dev without k8s:"
Write-Host "       pnpm infra:up  →  pnpm fabric:start  →  pnpm dev" -ForegroundColor Cyan
Write-Host ""
