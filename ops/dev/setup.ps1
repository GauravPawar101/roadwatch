# ops/dev/setup.ps1 — Bootstrap a fresh clone (deps, .env files, dirs, Fabric tooling)
#
# Run from repo root:
#   pnpm setup
#   pnpm setup -SkipInstall
#   .\ops\dev\setup.ps1 -KubernetesOnly   # skip local .env / WSL Fabric steps

param(
    [switch]$SkipInstall,
    [switch]$KubernetesOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

. (Join-Path $RepoRoot "ops\deploy\lib\PathHelpers.ps1")
$RepoWsl = Get-RepoWslPath $RepoRoot

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host ("━" * 64) -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host ("━" * 64) -ForegroundColor Cyan
}

function Write-Ok([string]$msg)   { Write-Host "  [ok] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  [warn] $msg" -ForegroundColor Yellow }

function Copy-EnvFile([string]$example, [string]$target) {
    if (-not (Test-Path $example)) {
        Write-Warn "Example missing: $example"
        return
    }
    if (Test-Path $target) {
        Write-Ok "$target exists — skipping"
    } else {
        Copy-Item $example $target
        Write-Ok "Created $target"
    }
}

$missingTools = @()

function Assert-Tool([string]$name, [string]$hint, [switch]$Required) {
    if (Get-Command $name -ErrorAction SilentlyContinue) {
        Write-Ok "$name found"
        return $true
    }
    Write-Warn "$name not found — $hint"
    if ($Required) { $script:missingTools += $name }
    return $false
}

# ── 1. Prerequisites ────────────────────────────────────────────────────────
Write-Step "1. Prerequisites"

Assert-Tool "docker" "Install Docker Desktop" -Required | Out-Null
if (Test-DockerReady) { Write-Ok "Docker daemon running" }
else { Write-Warn "Docker daemon not running — start Docker Desktop before deploy" }

if (-not $KubernetesOnly) {
    Assert-Tool "wsl" "wsl --install" | Out-Null
}
Assert-Tool "kind" "winget install Kubernetes.kind" | Out-Null
Assert-Tool "kubectl" "winget install Kubernetes.kubectl" | Out-Null

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Write-Ok "pnpm $(pnpm --version)"
} else {
    Write-Warn "Installing pnpm via corepack..."
    corepack enable 2>$null
    corepack prepare pnpm@8.10.0 --activate 2>$null
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { Write-Ok "pnpm installed" }
    else { $missingTools += "pnpm" }
}

# ── 2. Dependencies ─────────────────────────────────────────────────────────
Write-Step "2. Node dependencies"

if ($SkipInstall) {
    Write-Warn "Skipping pnpm install (-SkipInstall)"
} else {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Frozen lockfile failed — retrying without --frozen-lockfile"
        pnpm install
    }
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    Write-Ok "node_modules ready"
}

# ── 3. Local .env files (not used for k8s deploy) ─────────────────────────────
if (-not $KubernetesOnly) {
    Write-Step "3. Local .env files from examples"
    Copy-EnvFile ".env.example" ".env"
    Copy-EnvFile "apps\gateway-api\.env.example" "apps\gateway-api\.env"
    Copy-EnvFile "services\scheduler\.env.example" "services\scheduler\.env"
    Copy-EnvFile "services\webhook-handler\.env.example" "services\webhook-handler\.env"
    Copy-EnvFile "services\fabric-anchor-consumer\.env.example" "services\fabric-anchor-consumer\.env"
    Copy-EnvFile "apps\mobile-host\.env.example" "apps\mobile-host\.env"
    Copy-EnvFile "docker\.env.example" "docker\.env"
    Copy-EnvFile "fabric\network\.env.example" "fabric\network\.env"
}

# ── 4. Directories ────────────────────────────────────────────────────────────
Write-Step "4. Workspace directories"
@(".pids", "logs", "bin", "fabric\network\channel-artifacts") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
    Write-Ok $_
}

# Fabric .env required even for k8s (fabric-start generates org certs)
if (-not (Test-Path "fabric\network\.env")) {
    Copy-EnvFile "fabric\network\.env.example" "fabric\network\.env"
}

# ── 5. Fabric binaries (WSL / repo bin/) ──────────────────────────────────────
if (-not $KubernetesOnly) {
    Write-Step "5. Fabric binaries"
    $FABRIC_VERSION = "2.5.15"
    $peerCheck = wsl -d (Get-WslDistro) -- bash -lc "test -x '$RepoWsl/bin/peer' && echo ok || echo missing" 2>$null
    if ($peerCheck -eq "ok") {
        Write-Ok "Fabric binaries in bin/ (WSL)"
    } else {
        Write-Warn "Downloading Fabric $FABRIC_VERSION binaries into bin/ ..."
        $installScript = @"
#!/usr/bin/env bash
set -euo pipefail
REPO_WSL='$RepoWsl'
FABRIC_VERSION='$FABRIC_VERSION'
mkdir -p "`$REPO_WSL/bin"
cd /tmp
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version "`$FABRIC_VERSION" binary
cp -a bin/. "`$REPO_WSL/bin/"
echo done
"@
        $exit = Invoke-WslBash -Script $installScript
        if ($exit -eq 0) { Write-Ok "Fabric binaries installed" }
        else { Write-Warn "Fabric binary install failed — Fabric step will retry on start" }
    }

    Write-Step "6. Fabric chaincode dependencies"
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Get-ChildItem "fabric\chaincode\*\package.json" -ErrorAction SilentlyContinue | ForEach-Object {
            $dir = $_.Directory.FullName
            Write-Host "    npm install in $dir" -ForegroundColor Gray
            npm install --prefix $dir --prefer-offline 2>&1 | Out-Null
        }
        Write-Ok "Chaincode dependencies installed (host npm)"
    } else {
        Write-Warn "npm not found on host — skipping chaincode npm install"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host ("━" * 64) -ForegroundColor Green
Write-Host "  Setup complete" -ForegroundColor Green
Write-Host ("━" * 64) -ForegroundColor Green
Write-Host ""
Write-Host "  Next:" -ForegroundColor Yellow
Write-Host "    Local:       .\ops\dev\start-all.ps1" -ForegroundColor Cyan
Write-Host "    Kubernetes:  .\ops\dev\start-all.ps1 -Kubernetes" -ForegroundColor Cyan
Write-Host ""

if ($missingTools.Count -gt 0) {
    Write-Warn "Missing required tools: $($missingTools -join ', ')"
    exit 1
}
