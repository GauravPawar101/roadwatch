# start-all.ps1 - Start all RoadWatch services in separate colored windows
# Usage: .\start-all.ps1

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting RoadWatch Services..." -ForegroundColor White
Write-Host ""

function Import-DotEnv {
    param([string]$Path = ".env")

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not ($line -match "^([^=]+)=(.*)$")) {
            return
        }

        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        if ($key -and -not (Test-Path "Env:$key")) {
            Set-Item -Path "Env:$key" -Value $value
        }
    }
}

Import-DotEnv

$GatewayPort = if ($env:ROADWATCH_GATEWAY_PORT) { [int]$env:ROADWATCH_GATEWAY_PORT } else { 3100 }
$GatewayUrl = "http://localhost:$GatewayPort"
$PgBouncerHostPort = if ($env:TOP_PGBOUNCER_HOST_PORT) { [int]$env:TOP_PGBOUNCER_HOST_PORT } else { 16432 }
$PostgresHostPort = if ($env:TOP_POSTGRES_HOST_PORT) { [int]$env:TOP_POSTGRES_HOST_PORT } else { 15433 }
$RedisHostPort = if ($env:TOP_REDIS_HOST_PORT) { [int]$env:TOP_REDIS_HOST_PORT } else { 16379 }
$LocalDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:$PgBouncerHostPort/roadwatch"
$LocalRedisUrl = "redis://127.0.0.1:$RedisHostPort/0"
$ServiceRegistrySecret = if ($env:SERVICE_REGISTRY_SECRET) { $env:SERVICE_REGISTRY_SECRET } else { 'roadwatch-local-service-registry-secret' }
$ServiceAuthSecret = if ($env:SERVICE_AUTH_SECRET) { $env:SERVICE_AUTH_SECRET } else { 'local_development_cryptographic_secret' }

function Stop-TrackedProcess {
    param([string]$PidFile)

    if (-not (Test-Path $PidFile)) {
        return
    }

    try {
        $pid = [int](Get-Content -Raw $PidFile)
        if ($pid -gt 0) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # Ignore stale PID files and continue with a fresh startup.
    }
}

function Format-PsValue {
    param([string]$Value)

    return "'" + ($Value -replace "'", "''") + "'"
}

function New-EnvCommand {
    param([hashtable]$Environment)

    $pairs = foreach ($key in $Environment.Keys) {
        "`$env:$key=$(Format-PsValue ([string]$Environment[$key]))"
    }

    return ($pairs -join '; ')
}

# Pin local dev to the Docker PgBouncer endpoint so an inherited DATABASE_URL
# from the host shell cannot redirect the gateway to a different Postgres port.
$env:DATABASE_URL = $LocalDatabaseUrl
$env:REDIS_URL = $LocalRedisUrl
$env:SERVICE_REGISTRY_SECRET = $ServiceRegistrySecret
$env:SERVICE_AUTH_SECRET = $ServiceAuthSecret

# Stop any previously tracked service windows before relaunching.
Stop-TrackedProcess ".pids\fabric.pid"
Stop-TrackedProcess ".pids\gateway-api.pid"
Stop-TrackedProcess ".pids\backend-api.pid"
Stop-TrackedProcess ".pids\scheduler.pid"
Stop-TrackedProcess ".pids\webhook-handler.pid"
Stop-TrackedProcess ".pids\fabric-anchor-consumer.pid"
Stop-TrackedProcess ".pids\frontend.pid"

function Wait-ForHttp {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 90
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
        } catch {
            Start-Sleep -Seconds 1
            continue
        }

        Start-Sleep -Seconds 1
    }

    throw "Timed out waiting for $Url"
}

function Wait-ForTcpPort {
    param(
        [int[]]$Ports,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $allOpen = $true
        foreach ($port in $Ports) {
            try {
                $client = [System.Net.Sockets.TcpClient]::new()
                $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
                if (-not $iar.AsyncWaitHandle.WaitOne(500)) {
                    $allOpen = $false
                } else {
                    $client.EndConnect($iar)
                }
                $client.Close()
            } catch {
                $allOpen = $false
            }

            if (-not $allOpen) {
                break
            }
        }

        if ($allOpen) {
            return
        }

        Start-Sleep -Seconds 2
    }

    throw "Timed out waiting for TCP ports: $($Ports -join ', ')"
}

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
        if (Test-Path $LogFile) {
            try {
                Clear-Content -Path $LogFile -ErrorAction Stop
            } catch {
                Write-Host "WARN: Could not clear locked log file $LogFile; appending to the existing file instead" -ForegroundColor Yellow
            }
        }
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
# Step 1: Start infrastructure (Docker - background)
Write-Host "📦 Step 1: Starting Postgres, Kafka, Redis, and Zookeeper..." -ForegroundColor Blue
docker-compose up -d

Write-Host "⏳ Waiting for Postgres ($PostgresHostPort) and PgBouncer (16432) to be ready..." -ForegroundColor Blue
Wait-ForTcpPort -Ports @($PostgresHostPort, 16432) -TimeoutSeconds 100

Write-Host "⏳ Running Redis and Kafka initialization script..." -ForegroundColor Blue
pnpm init:messaging

# Give PgBouncer a moment to finish its own auth init after the port opens
Start-Sleep -Seconds 3

Write-Host "✓ Infrastructure services started and messaging initialized" -ForegroundColor Green
Write-Host ""

Write-Host "⏳ Waiting for Kafka (localhost:9094) to be ready..." -ForegroundColor Blue
try {
    Wait-ForTcpPort -Ports @(9094) -TimeoutSeconds 120
    Write-Host "✓ Kafka is listening on 9094" -ForegroundColor Green
} catch {
    Write-Host "WARN: Timed out waiting for Kafka on localhost:9094; continuing startup" -ForegroundColor Yellow
}
# Ensure required directories exist before any service starts
New-Item -ItemType Directory -Force -Path .pids | Out-Null
New-Item -ItemType Directory -Force -Path .\logs | Out-Null

# Step 2: Hyperledger Fabric in WSL - Lime Green
Write-Host "⛓️  Step 2: Starting Hyperledger Fabric in WSL..." -ForegroundColor Blue

# Pass the WSL command as a single string arg to avoid && being parsed by PowerShell.
# Explicitly source ~/.profile so the RoadWatch Fabric env block is available in Ubuntu WSL.
$fabricCmd = 'wsl -d Ubuntu -- bash -lc "source ~/.profile >/dev/null 2>&1; set -e; cd /mnt/c/Users/Gaurav/Desktop/roadWatch/fabric/network; ./scripts/start.sh"'

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
    # Production Fix: Intercept and route heavy seed operations directly to Postgres (5433)
    # to avoid PgBouncer transaction-pooling drops.
    $PostgresHostPort = if ($env:TOP_POSTGRES_HOST_PORT) { [int]$env:TOP_POSTGRES_HOST_PORT } else { 15433 }
    $DirectDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:$PostgresHostPort/roadwatch"
    
    $OldDbUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $DirectDatabaseUrl
    
    pnpm seed:demo
    
    # Restore PgBouncer endpoint for remaining application startup steps
    $env:DATABASE_URL = $OldDbUrl

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Database seeded" -ForegroundColor Green
    } else {
        Write-Host "WARN: Database seed failed; continuing startup so the rest of the stack can come up" -ForegroundColor Yellow
    }
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

# Vite port (frontend) - allow override from .env
$VitePort = if ($env:VITE_PORT) { [int]$env:VITE_PORT } else { 5173 }

# Step 4: Gateway API - Cyan
Write-Host "🔌 Step 4: Starting Gateway API in separate terminal..." -ForegroundColor Blue
$gatewayProc = Start-ServiceWindow `
    -Title "🔌 RoadWatch — Gateway API  |  $GatewayUrl" `
    -Command ((New-EnvCommand @{ PORT = $GatewayPort; DATABASE_URL = $LocalDatabaseUrl; REDIS_URL = $LocalRedisUrl; SERVICE_REGISTRY_SECRET = $ServiceRegistrySecret; SERVICE_AUTH_SECRET = $ServiceAuthSecret }) + "; pnpm --filter @roadwatch/gateway-api dev") `
    -Color "Cyan" `
    -PidFile ".pids\gateway-api.pid" `
    -LogFile ".\logs\gateway-api.log"
Write-Host "✓ Gateway API window opened (PID: $($gatewayProc.Id))" -ForegroundColor Green
Write-Host ""

Write-Host "⏳ Waiting for Gateway API to become healthy..." -ForegroundColor Blue
Wait-ForHttp -Url "$GatewayUrl/health" -TimeoutSeconds 120
Write-Host "✓ Gateway API is healthy" -ForegroundColor Green
Write-Host ""

# Step 5: Backend API - Blue
Write-Host "🔧 Step 5: Starting Backend API in separate terminal..." -ForegroundColor Blue
$backendProc = Start-ServiceWindow `
    -Title "🔧 RoadWatch — Backend API  |  http://localhost:$preferredBackendPort" `
    -Command ((New-EnvCommand @{ BACKEND_PORT = $preferredBackendPort; DATABASE_URL = $LocalDatabaseUrl; REDIS_URL = $LocalRedisUrl; GATEWAY_URL = $GatewayUrl; KAFKA_BROKERS = '127.0.0.1:9094'; SERVICE_NAME = 'backend-api'; SERVICE_URL = "http://127.0.0.1:$preferredBackendPort"; SERVICE_REGISTRY_SECRET = $ServiceRegistrySecret; SERVICE_AUTH_SECRET = $ServiceAuthSecret }) + "; pnpm --dir backend-api dev") `
    -Color "Blue" `
    -PidFile ".pids\backend-api.pid" `
    -LogFile ".\logs\backend-api.log"
Write-Host "✓ Backend API window opened (PID: $($backendProc.Id))" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 3

# Step 6: Scheduler - Yellow
Write-Host "🗓️  Step 6: Starting Scheduler in separate terminal..." -ForegroundColor Blue
$schedulerProc = Start-ServiceWindow `
    -Title "🗓️  RoadWatch — Scheduler" `
    -Command ((New-EnvCommand @{ DATABASE_URL = $LocalDatabaseUrl; REDIS_URL = $LocalRedisUrl; GATEWAY_URL = $GatewayUrl; SERVICE_NAME = 'scheduler'; SERVICE_URL = 'service://scheduler'; SERVICE_REGISTRY_SECRET = $ServiceRegistrySecret; SERVICE_AUTH_SECRET = $ServiceAuthSecret }) + "; pnpm --dir services/scheduler dev") `
    -Color "Yellow" `
    -PidFile ".pids\scheduler.pid" `
    -LogFile ".\logs\scheduler.log"
Write-Host "✓ Scheduler window opened (PID: $($schedulerProc.Id))" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 2

# Step 7: Webhook Handler - Dark Yellow
Write-Host "🪝 Step 7: Starting Webhook Handler in separate terminal..." -ForegroundColor Blue
$webhookProc = Start-ServiceWindow `
    -Title "🪝 RoadWatch — Webhook Handler" `
    -Command ((New-EnvCommand @{ DATABASE_URL = $LocalDatabaseUrl; REDIS_URL = $LocalRedisUrl; GATEWAY_URL = $GatewayUrl; SERVICE_NAME = 'webhook-handler'; SERVICE_URL = 'service://webhook-handler'; SERVICE_REGISTRY_SECRET = $ServiceRegistrySecret; SERVICE_AUTH_SECRET = $ServiceAuthSecret }) + "; pnpm --dir services/webhook-handler dev") `
    -Color "DarkYellow" `
    -PidFile ".pids\webhook-handler.pid" `
    -LogFile ".\logs\webhook-handler.log"
Write-Host "✓ Webhook Handler window opened (PID: $($webhookProc.Id))" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 2

# Step 8: Fabric Anchor Consumer - Green
Write-Host "⛓️  Step 8: Waiting for Fabric ports before starting anchor consumer..." -ForegroundColor Blue
Wait-ForTcpPort -Ports @(17050, 17051, 19051) -TimeoutSeconds 300
Write-Host "✓ Fabric ports are ready" -ForegroundColor Green
Write-Host ""

$fabricAnchorProc = Start-ServiceWindow `
    -Title "⛓️  RoadWatch — Fabric Anchor Consumer" `
    -Command ((New-EnvCommand @{ DATABASE_URL = $LocalDatabaseUrl; GATEWAY_URL = $GatewayUrl; SERVICE_NAME = 'fabric-anchor-consumer'; SERVICE_URL = 'service://fabric-anchor-consumer'; SERVICE_REGISTRY_SECRET = $ServiceRegistrySecret; SERVICE_AUTH_SECRET = $ServiceAuthSecret }) + "; pnpm --dir services/fabric-anchor-consumer dev") `
    -Color "Green" `
    -PidFile ".pids\fabric-anchor-consumer.pid" `
    -LogFile ".\logs\fabric-anchor-consumer.log"
Write-Host "✓ Fabric Anchor Consumer window opened (PID: $($fabricAnchorProc.Id))" -ForegroundColor Green
Write-Host ""

# Step 9: Frontend - Magenta
Write-Host "🌐 Step 9: Starting Frontend in separate terminal..." -ForegroundColor Blue
$frontendProc = Start-ServiceWindow `
    -Title "🌐 RoadWatch — Frontend  |  http://localhost:$VitePort" `
    -Command ((New-EnvCommand @{ VITE_API_BASE = $GatewayUrl; VITE_PORT = $VitePort }) + "; pnpm --filter roadwatch-frontend dev") `
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
Write-Host "  🌐 Frontend:          http://localhost:$VitePort    " -NoNewline; Write-Host "[MAGENTA]" -ForegroundColor Magenta
Write-Host "  🔌 Gateway API:       $GatewayUrl    " -NoNewline; Write-Host "[CYAN]"    -ForegroundColor Cyan
Write-Host "  🗓️  Scheduler:         service://scheduler    " -NoNewline; Write-Host "[YELLOW]"   -ForegroundColor Yellow
Write-Host "  🪝 Webhook Handler:    service://webhook-handler    " -NoNewline; Write-Host "[DARKYELLOW]" -ForegroundColor DarkYellow
Write-Host "  ⛓️  Fabric Anchor:     service://fabric-anchor-consumer    " -NoNewline; Write-Host "[GREEN]"   -ForegroundColor Green
Write-Host "  ⛓️  Fabric (WSL):                               " -NoNewline; Write-Host "[GREEN]"   -ForegroundColor Green
Write-Host "  📦 PostgreSQL:        localhost:$PostgresHostPort            [BACKGROUND - Docker]" -ForegroundColor Gray
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