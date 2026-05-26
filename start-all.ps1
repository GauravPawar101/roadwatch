# start-all.ps1 - Start all RoadWatch services in separate colored windows
# Usage: .\start-all.ps1

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting RoadWatch Services..." -ForegroundColor White
Write-Host ""

$GatewayPort = if ($env:ROADWATCH_GATEWAY_PORT) { [int]$env:ROADWATCH_GATEWAY_PORT } else { 3100 }
$GatewayUrl = "http://localhost:$GatewayPort"
$LocalDatabaseUrl = 'postgresql://postgres:postgres@127.0.0.1:6432/roadwatch'

# Pin local dev to the Docker PgBouncer endpoint so an inherited DATABASE_URL
# from the host shell cannot redirect the gateway to a different Postgres port.
$env:DATABASE_URL = $LocalDatabaseUrl

# Helper: launches a service in a new PowerShell window with a custom font color (black background).
# Uses -EncodedCommand so the command string is never re-parsed by the child PowerShell process.
function Start-ServiceWindow {
    param(
        [string]$Title,
        [string]$Command,
        [string]$Color,     # ForegroundColor only - looks good on black
        [string]$PidFile,
        [string]$LogFile
    )

    # Build the full script as a plain string, then Base64-encode it.
    # This means semicolons, &&, quotes etc. inside $Command are never touched by PS.
    $script = @"
`$Host.UI.RawUI.WindowTitle = '$Title'
`$Host.UI.RawUI.ForegroundColor = '$Color'
Write-Host '  $Title'
Write-Host ('=' * 60)
$Command 2>&1 | Tee-Object -FilePath '$LogFile'
"@

    if ($LogFile) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
        Set-Content -Path $LogFile -Value '' -Encoding utf8
    }

    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))

    $proc = Start-Process powershell `
        -ArgumentList "-NoExit", "-EncodedCommand", $encoded `
        -PassThru

    if ($PidFile) {
        $proc.Id | Out-File -FilePath $PidFile -Encoding utf8
    }

    return $proc
}

# Step 1: Start infrastructure (Docker - background)
Write-Host "📦 Step 1: Starting Postgres, Kafka, Redis, and Zookeeper..." -ForegroundColor Blue
docker-compose up -d postgres zookeeper kafka redis
Write-Host "✓ Infrastructure services started" -ForegroundColor Green
Write-Host ""

# Ensure required directories exist before any service starts
New-Item -ItemType Directory -Force -Path .pids | Out-Null

# Step 2: Hyperledger Fabric in WSL - Lime Green
Write-Host "⛓️  Step 2: Starting Hyperledger Fabric in WSL..." -ForegroundColor Blue

# Pass the WSL command as a single string arg to avoid && being parsed by PowerShell
$fabricCmd = 'wsl -d Ubuntu -- bash -lc "set -e; cd /mnt/c/Users/Gaurav/Desktop/roadWatch/fabric/network; ./scripts/start.sh"'

$fabricProc = Start-ServiceWindow `
    -Title "⛓️  RoadWatch — Hyperledger Fabric (WSL)" `
    -Command $fabricCmd `
    -Color "Green" `
    -PidFile ".pids\fabric.pid" `
    -LogFile ".\logs\fabric.log"
Write-Host "✓ Hyperledger Fabric window opened (PID: $($fabricProc.Id))" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 5

# Step 3: Seed database (default on, opt-out via env var)
Write-Host "🌱 Step 3: Seeding backend database..." -ForegroundColor Blue
$skipDbSeed = $env:ROADWATCH_SKIP_DB_SEED -eq "1" -or $env:SKIP_DB_SEED -eq "1"
if ($skipDbSeed) {
    Write-Host "Skipping database seed because ROADWATCH_SKIP_DB_SEED=1 (or SKIP_DB_SEED=1)" -ForegroundColor Yellow
} else {
    pnpm seed:demo
    Write-Host "✓ Database seeded" -ForegroundColor Green
}
Write-Host ""

# Determine a usable backend port (prefer 4001; fall back to 5001)
$preferredBackendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 4001 }
function Test-PortAvailable {
    param([int]$p)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}
if (-not (Test-PortAvailable $preferredBackendPort)) {
    Write-Host "Port $preferredBackendPort not available; falling back to 5001" -ForegroundColor Yellow
    $preferredBackendPort = 5001
}
$env:BACKEND_PORT = $preferredBackendPort

# Step 4: Backend API - Blue
Write-Host "🔧 Step 4: Starting Backend API in separate terminal..." -ForegroundColor Blue
$backendProc = Start-ServiceWindow `
    -Title "🔧 RoadWatch — Backend API  |  http://localhost:$preferredBackendPort" `
    -Command "`$env:BACKEND_PORT=$preferredBackendPort; `$env:DATABASE_URL='$LocalDatabaseUrl'; pnpm --dir backend-api dev" `
    -Color "Blue" `
    -PidFile ".pids\backend-api.pid" `
    -LogFile ".\logs\backend-api.log"
Write-Host "✓ Backend API window opened (PID: $($backendProc.Id))" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 3

# Step 5: Gateway API - Cyan
Write-Host "🔌 Step 5: Starting Gateway API in separate terminal..." -ForegroundColor Blue
$gatewayProc = Start-ServiceWindow `
    -Title "🔌 RoadWatch — Gateway API  |  $GatewayUrl" `
    -Command "`$env:PORT=$GatewayPort; `$env:DATABASE_URL='$LocalDatabaseUrl'; pnpm --filter @roadwatch/gateway-api dev" `
    -Color "Cyan" `
    -PidFile ".pids\gateway-api.pid" `
    -LogFile ".\logs\gateway-api.log"
Write-Host "✓ Gateway API window opened (PID: $($gatewayProc.Id))" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 3

# Step 6: Frontend - Magenta
Write-Host "🌐 Step 6: Starting Frontend in separate terminal..." -ForegroundColor Blue
$frontendProc = Start-ServiceWindow `
    -Title "🌐 RoadWatch — Frontend  |  http://localhost:5173" `
    -Command "`$env:VITE_API_BASE='$GatewayUrl'; pnpm --filter roadwatch-frontend dev" `
    -Color "Magenta" `
    -PidFile ".pids\frontend.pid" `
    -LogFile ".\logs\frontend.log"
Write-Host "✓ Frontend window opened (PID: $($frontendProc.Id))" -ForegroundColor Green
Write-Host ""

# Summary
Write-Host ("━" * 62) -ForegroundColor Green
Write-Host "✨ All services started successfully!" -ForegroundColor Green
Write-Host ("━" * 62) -ForegroundColor Green
Write-Host ""
Write-Host "📋 Service URLs & Windows:" -ForegroundColor Yellow
Write-Host "  🔧 Backend API:       http://localhost:$preferredBackendPort    " -NoNewline; Write-Host "[BLUE]"     -ForegroundColor Blue
Write-Host "  🌐 Frontend:          http://localhost:5173    " -NoNewline; Write-Host "[MAGENTA]" -ForegroundColor Magenta
Write-Host "  🔌 Gateway API:       $GatewayUrl    " -NoNewline; Write-Host "[CYAN]"    -ForegroundColor Cyan
Write-Host "  ⛓️  Fabric (WSL):                               " -NoNewline; Write-Host "[GREEN]"   -ForegroundColor Green
Write-Host "  📦 PostgreSQL:        localhost:5433            [BACKGROUND - Docker]" -ForegroundColor Gray
Write-Host "  📨 Kafka:             localhost:9094            [BACKGROUND - Docker]" -ForegroundColor Gray
Write-Host "  💾 Redis:             localhost:16379           [BACKGROUND - Docker]" -ForegroundColor Gray
Write-Host "  ⛓️  Fabric Peer NHAI:  localhost:7051            [WSL]"                -ForegroundColor Gray
Write-Host "  ⛓️  Fabric Peer RW:    localhost:9051            [WSL]"                -ForegroundColor Gray
Write-Host "  ⛓️  Fabric Orderer:    localhost:7050            [WSL]"                -ForegroundColor Gray
Write-Host ""
Write-Host "💡 Tips:" -ForegroundColor Yellow
Write-Host "  • Each service has its own color-coded terminal window"
Write-Host "  • Close a window to stop that service individually"
Write-Host "  • Or stop everything at once with: .\stop-all.ps1"
Write-Host ""
Write-Host "🛑 To stop all services:" -ForegroundColor Yellow
Write-Host "  .\stop-all.ps1"
Write-Host ""