# start-all.ps1 — One command to set up and run RoadWatch (local or Kubernetes)
#
# Usage:
#   .\ops\dev\start-all.ps1                    # local: Docker Compose + dev service windows
#   .\ops\dev\start-all.ps1 -Kubernetes        # kind: build images, secrets, full k8s deploy
#   .\ops\dev\start-all.ps1 -Kubernetes -Reset
#   .\ops\dev\start-all.ps1 -SkipFabric
#   .\ops\dev\start-all.ps1 -SkipSeed
#   .\ops\dev\start-all.ps1 -SkipSetup         # skip bootstrap (deps/.env)

param(
    [switch]$Kubernetes,
    [switch]$Local,

    [string]$DistrictId = '',
    [string]$DistrictCode = '',
    [ValidateSet('dev', 'prod')]
    [string]$Environment = 'dev',

    [switch]$SkipFabric,
    [switch]$SkipSeed,
    [switch]$SkipSetup,

    # kind / k8s flags (used with -Kubernetes)
    [switch]$Reset,
    [switch]$SkipBuild,
    [switch]$InfraOnly,
    [switch]$SkipFabricCerts,
    [switch]$WithFabric,
    [switch]$WaitReady
)

$ErrorActionPreference = "Stop"

if ($Kubernetes -and $Local) {
    throw "Use only one of -Kubernetes or -Local."
}

$UseKubernetes = $Kubernetes.IsPresent
if (-not $UseKubernetes -and -not $Local.IsPresent) {
    $UseKubernetes = $false
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

. (Join-Path $RepoRoot "ops\deploy\lib\Resolve-DeployContext.ps1")
. (Join-Path $RepoRoot "ops\deploy\lib\PathHelpers.ps1")

# Default district for local demo seed only (not k8s infra).
if (-not $UseKubernetes -and -not $DistrictId -and -not $DistrictCode) {
    $DistrictCode = 'MH-MUM'
}

$DeployCtx = Resolve-DeployContext `
    -DistrictId $DistrictId `
    -DistrictCode $DistrictCode `
    -Environment $Environment `
    -Target $(if ($UseKubernetes) { 'kind' } else { 'local' })
Write-DeployContext $DeployCtx

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host ("━" * 64) -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host ("━" * 64) -ForegroundColor Cyan
}

function Assert-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name not found. $Hint"
    }
}

function Ensure-ProjectSetup {
    if ($SkipSetup) {
        Write-Host "  Skipping setup (-SkipSetup)" -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path .pids, logs, bin, fabric\network\channel-artifacts | Out-Null
        return
    }

    $setupArgs = @()
    if ($UseKubernetes) { $setupArgs += '-KubernetesOnly' }
    if (Test-Path "node_modules") { $setupArgs += '-SkipInstall' }

    & (Join-Path $RepoRoot "ops\dev\setup.ps1") @setupArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Start-KubernetesStack {
    Write-Step "Kubernetes deploy (kind + build + ConfigMaps/Secrets)"

    Assert-Command docker "Start Docker Desktop, then re-run."
    if (-not (Test-DockerReady)) {
        throw @"
Docker daemon is not running.
  1. Start Docker Desktop and wait until it shows 'Running'
  2. Re-run: .\ops\dev\start-all.ps1 -Kubernetes
"@
    }

    Assert-Command kind "Install: winget install Kubernetes.kind"
    Assert-Command kubectl "Install: winget install Kubernetes.kubectl"

    $fabricCerts = Test-FabricK8sCertsPresent -RepoRoot $RepoRoot
    if ($WithFabric -and -not $fabricCerts) {
        throw @"
Fabric certificates not found. Generate them first:
  1. Start Docker Desktop
  2. .\ops\dev\start-all.ps1 -Local -SkipSeed
     (wait for Fabric step in WSL), or run fabric\network\scripts\start.sh in WSL
  3. Re-run: .\ops\dev\start-all.ps1 -Kubernetes -WithFabric
"@
    }
    if (-not $WithFabric -and -not $SkipFabricCerts -and -not $fabricCerts) {
        Write-Host "  Fabric certs not found — using -SkipFabricCerts (fabric-anchor skipped)" -ForegroundColor Yellow
        $SkipFabricCerts = $true
    }

    $kindParams = @{
        Environment = $Environment
        WaitReady   = $true
    }
    if ($Reset) { $kindParams.Reset = $true }
    if ($SkipBuild) { $kindParams.SkipBuild = $true }
    if ($InfraOnly) { $kindParams.InfraOnly = $true }
    if ($SkipFabricCerts) { $kindParams.SkipFabricCerts = $true }

    & (Join-Path $RepoRoot "ops\deploy\deploy-kind.ps1") @kindParams
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host ""
    Write-Host "  Kubernetes stack is up." -ForegroundColor Green
    Write-Host "    Frontend: http://localhost:30080" -ForegroundColor White
    Write-Host "    Gateway:  http://localhost:30100" -ForegroundColor White
    Write-Host "    Backend:  http://localhost:30401" -ForegroundColor White
    Write-Host "    Config:   k8s/overlays/$Environment (ConfigMaps + Secrets)" -ForegroundColor White
    Write-Host ""
    Write-Host "  Logs:  kubectl logs -n roadwatch deploy/gateway -f" -ForegroundColor Gray
    Write-Host "  Stop:  kind delete cluster --name roadwatch" -ForegroundColor Gray
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════════════════════
# Kubernetes path
# ══════════════════════════════════════════════════════════════════════════════

if ($UseKubernetes) {
    Write-Host "RoadWatch — Kubernetes mode (-Kubernetes)" -ForegroundColor White
    Ensure-ProjectSetup
    Start-KubernetesStack
    exit 0
}

# ══════════════════════════════════════════════════════════════════════════════
# Local path (Docker Compose + dev terminals)
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "RoadWatch — Local dev mode (Docker Compose + service windows)" -ForegroundColor White
Ensure-ProjectSetup

$GatewayPort = 3100
$GatewayUrl = "http://localhost:$GatewayPort"
$LocalDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:16432/roadwatch"
$LocalRedisUrl = "redis://127.0.0.1:16379/0"
$PostgresHostPort = if ($env:TOP_POSTGRES_HOST_PORT) { [int]$env:TOP_POSTGRES_HOST_PORT } else { 15433 }
$PgBouncerHostPort = if ($env:TOP_PGBOUNCER_HOST_PORT) { [int]$env:TOP_PGBOUNCER_HOST_PORT } else { 16432 }

function Stop-TrackedProcess {
    param([string]$PidFile)
    if (-not (Test-Path $PidFile)) { return }
    try {
        $procId = [int](Get-Content -Raw $PidFile)
        if ($procId -gt 0) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    } catch { }
}

function Format-PsValue { param([string]$Value); return "'" + ($Value -replace "'", "''") + "'" }

function New-EnvCommand {
    param([hashtable]$Environment)
    return (($Environment.Keys | ForEach-Object { "`$env:$_=$(Format-PsValue ([string]$Environment[$_]))" }) -join '; ')
}

function Get-LocalServiceEnvBlock {
    param([string]$ServiceName, [string]$ServiceUrl, [int]$RedisDb = 0)
    return @{
        NODE_ENV                = 'development'
        DATABASE_URL            = $LocalDatabaseUrl
        REDIS_URL               = "redis://127.0.0.1:16379/$RedisDb"
        KAFKA_HLF_BROKERS       = '127.0.0.1:9094'
        KAFKA_EVENTS_BROKERS    = '127.0.0.1:9095'
        KAFKA_BROKERS           = '127.0.0.1:9095'
        GATEWAY_URL             = $GatewayUrl
        JWT_SECRET              = 'roadwatch-local-dev-jwt-secret-replace-in-production'
        SERVICE_NAME            = $ServiceName
        SERVICE_URL             = $ServiceUrl
        ALLOW_DEV_OTP_ECHO      = 'true'
    }
}

function Wait-ForHttp {
    param([string]$Url, [int]$TimeoutSeconds = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return }
        } catch { }
        Start-Sleep -Seconds 1
    }
    throw "Timed out waiting for $Url"
}

function Wait-ForTcpPort {
    param([int[]]$Ports, [int]$TimeoutSeconds = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $allOpen = $true
        foreach ($port in $Ports) {
            try {
                $c = [System.Net.Sockets.TcpClient]::new()
                $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
                if (-not $iar.AsyncWaitHandle.WaitOne(800)) { $allOpen = $false }
                else { $c.EndConnect($iar) }
                $c.Close()
            } catch { $allOpen = $false }
            if (-not $allOpen) { break }
        }
        if ($allOpen) { return }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for TCP ports: $($Ports -join ', ')"
}

function Start-ServiceWindow {
    param([string]$Title, [string]$Command, [string]$Color, [string]$PidFile, [string]$LogFile)
    $inner = @"
`$Host.UI.RawUI.WindowTitle = '$Title'
`$Host.UI.RawUI.ForegroundColor = '$Color'
Write-Host '  $Title'
Write-Host ('=' * 60)
$Command 2>&1 | Tee-Object -FilePath '$LogFile'
"@
    if ($LogFile) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
    }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    $proc = Start-Process powershell -ArgumentList "-NoExit", "-EncodedCommand", $encoded -PassThru
    if ($PidFile) { $proc.Id | Out-File -FilePath $PidFile -Encoding utf8 }
    return $proc
}

$env:DATABASE_URL = $LocalDatabaseUrl
$env:REDIS_URL = $LocalRedisUrl

foreach ($f in @(
    ".pids\fabric.pid", ".pids\gateway-api.pid", ".pids\backend-api.pid",
    ".pids\scheduler.pid", ".pids\webhook-handler.pid", ".pids\fabric-anchor-consumer.pid", ".pids\frontend.pid"
)) { Stop-TrackedProcess $f }

# Step 1 — Docker infrastructure
Write-Step "Docker infrastructure (Postgres, Redis, Kafka)"

Assert-Command docker "Install Docker Desktop: https://docs.docker.com/desktop/windows/"
if (-not (Test-DockerReady)) {
    throw @"
Docker daemon is not running.
  1. Start Docker Desktop and wait until it shows 'Running'
  2. Re-run: .\ops\dev\start-all.ps1
"@
}

Write-Host "  docker compose up -d ..." -ForegroundColor White
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed (exit $LASTEXITCODE). Check Docker Desktop logs."
}

Write-Host "  Waiting for Postgres ($PostgresHostPort) and PgBouncer ($PgBouncerHostPort)..." -ForegroundColor Blue
try {
    Wait-ForTcpPort -Ports @($PostgresHostPort, $PgBouncerHostPort) -TimeoutSeconds 120
    Write-Host "  Database ports open" -ForegroundColor Green
} catch {
    throw "Infrastructure did not become ready. Run: docker compose ps`n  $_"
}

Write-Host "  Waiting for Kafka (9094, 9095) and Redis (16379)..." -ForegroundColor Blue
try {
    Wait-ForTcpPort -Ports @(9094, 9095, 16379) -TimeoutSeconds 120
    Write-Host "  Messaging + cache ready" -ForegroundColor Green
} catch {
    Write-Host "  WARN: Kafka/Redis not all ready yet — continuing ($($_.Exception.Message))" -ForegroundColor Yellow
}

# Step 2 — Fabric (WSL)
if (-not $SkipFabric) {
    Write-Step "Hyperledger Fabric (WSL)"
    $wslRepo = Get-RepoWslPath $RepoRoot
    $fabricScriptPath = Join-Path $RepoRoot "logs\wsl-fabric-start.sh"
    $fabricScript = @"
#!/usr/bin/env bash
set -euo pipefail
REPO_WSL='$wslRepo'
export PATH="`$REPO_WSL/bin:/usr/local/bin:/usr/bin:/bin"
cd "`$REPO_WSL/fabric/network"
exec ./scripts/start.sh
"@
    Write-UnixScript -Path $fabricScriptPath -Content $fabricScript
    $wslScript = Convert-ToWslPath $fabricScriptPath
    $distro = Get-WslDistro
    $fabricCmd = "wsl -d $distro -- bash -lc `"bash '$wslScript'`""
    $fabricProc = Start-ServiceWindow `
        -Title "RoadWatch — Fabric (WSL)" `
        -Command $fabricCmd `
        -Color "Green" `
        -PidFile ".pids\fabric.pid" `
        -LogFile ".\logs\fabric.log"
    Write-Host "  Fabric window opened (PID $($fabricProc.Id))" -ForegroundColor Green
    Start-Sleep -Seconds 5
} else {
    Write-Host "  Skipping Fabric (-SkipFabric)" -ForegroundColor Yellow
}

# Step 3 — Seed
Write-Step "Database seed"
if ($SkipSeed -or $env:ROADWATCH_SKIP_DB_SEED -eq '1') {
    Write-Host "  Skipped (-SkipSeed)" -ForegroundColor Yellow
} else {
    $directUrl = "postgresql://postgres:postgres@127.0.0.1:${PostgresHostPort}/roadwatch"
    $old = $env:DATABASE_URL
    $env:DATABASE_URL = $directUrl
    pnpm seed:demo
    $env:DATABASE_URL = $old
    if ($LASTEXITCODE -eq 0) { Write-Host "  Seeded" -ForegroundColor Green }
    else { Write-Host "  WARN: seed failed — continuing" -ForegroundColor Yellow }
}

# Step 4–9 — App services
$preferredBackendPort = 4001
function Test-PortAvailable([int]$p) {
    try {
        $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
        $l.Start(); $l.Stop(); return $true
    } catch { return $false }
}
if (-not (Test-PortAvailable $preferredBackendPort)) { $preferredBackendPort = 5001 }

$VitePort = 5173
$gatewayEnv = Get-LocalServiceEnvBlock -ServiceName 'gateway' -ServiceUrl $GatewayUrl
$gatewayEnv.PORT = $GatewayPort

Write-Step "Application services"

$gatewayProc = Start-ServiceWindow `
    -Title "RoadWatch — Gateway  |  $GatewayUrl" `
    -Command ((New-EnvCommand $gatewayEnv) + "; pnpm --filter @roadwatch/gateway-api dev") `
    -Color "Cyan" -PidFile ".pids\gateway-api.pid" -LogFile ".\logs\gateway-api.log"
Write-Host "  Gateway PID $($gatewayProc.Id)" -ForegroundColor Green

Wait-ForHttp -Url "$GatewayUrl/health" -TimeoutSeconds 120

$backendEnv = Get-LocalServiceEnvBlock -ServiceName 'backend-api' -ServiceUrl "http://127.0.0.1:$preferredBackendPort"
$backendEnv.BACKEND_PORT = $preferredBackendPort
Start-ServiceWindow `
    -Title "RoadWatch — Backend  |  :$preferredBackendPort" `
    -Command ((New-EnvCommand $backendEnv) + "; pnpm --dir backend-api dev") `
    -Color "Blue" -PidFile ".pids\backend-api.pid" -LogFile ".\logs\backend-api.log" | Out-Null

Start-ServiceWindow `
    -Title "RoadWatch — Scheduler" `
    -Command ((New-EnvCommand (Get-LocalServiceEnvBlock -ServiceName 'scheduler' -ServiceUrl 'service://scheduler')) + "; pnpm --dir services/scheduler dev") `
    -Color "Yellow" -PidFile ".pids\scheduler.pid" -LogFile ".\logs\scheduler.log" | Out-Null

Start-ServiceWindow `
    -Title "RoadWatch — Webhook" `
    -Command ((New-EnvCommand (Get-LocalServiceEnvBlock -ServiceName 'webhook-handler' -ServiceUrl 'service://webhook-handler' -RedisDb 1)) + "; pnpm --dir services/webhook-handler dev") `
    -Color "DarkYellow" -PidFile ".pids\webhook-handler.pid" -LogFile ".\logs\webhook-handler.log" | Out-Null

if (-not $SkipFabric) {
    try {
        Wait-ForTcpPort -Ports @(17050, 17051, 19051) -TimeoutSeconds 300
    } catch {
        Write-Host "  WARN: Fabric ports not ready — starting anchor anyway" -ForegroundColor Yellow
    }
    Start-ServiceWindow `
        -Title "RoadWatch — Fabric Anchor" `
        -Command ((New-EnvCommand (Get-LocalServiceEnvBlock -ServiceName 'fabric-anchor-consumer' -ServiceUrl 'service://fabric-anchor-consumer' -RedisDb 2)) + "; pnpm --dir services/fabric-anchor-consumer dev") `
        -Color "Green" -PidFile ".pids\fabric-anchor-consumer.pid" -LogFile ".\logs\fabric-anchor-consumer.log" | Out-Null
}

Start-ServiceWindow `
    -Title "RoadWatch — Frontend  |  :$VitePort" `
    -Command ((New-EnvCommand (@{
        VITE_API_BASE           = $GatewayUrl
        VITE_PORT               = $VitePort
        GATEWAY_URL             = $GatewayUrl
        SERVICE_NAME            = 'roadwatch-frontend'
    })) + "; pnpm --filter roadwatch-frontend dev") `
    -Color "Magenta" -PidFile ".pids\frontend.pid" -LogFile ".\logs\frontend.log" | Out-Null

Write-Host ""
Write-Host ("━" * 64) -ForegroundColor Green
Write-Host "  All services started" -ForegroundColor Green
Write-Host ("━" * 64) -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend:  http://localhost:$VitePort" -ForegroundColor White
Write-Host "  Gateway:   $GatewayUrl" -ForegroundColor White
Write-Host "  Backend:   http://localhost:$preferredBackendPort" -ForegroundColor White
Write-Host ""
Write-Host "  Kubernetes instead:  .\ops\dev\start-all.ps1 -Kubernetes" -ForegroundColor Gray
Write-Host "  Stop everything:       .\ops\teardown\stop-all.ps1" -ForegroundColor Gray
Write-Host ""
