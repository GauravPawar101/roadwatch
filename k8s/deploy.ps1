#!/usr/bin/env pwsh
# k8s/deploy.ps1 — Apply RoadWatch manifests (layer subset or full overlay)
#
# Infra is district-agnostic. Config comes from k8s ConfigMaps/Secrets only.
#
# Usage:
#   .\k8s\deploy.ps1                          # full stack (overlay dev)
#   .\k8s\deploy.ps1 -Layer 0                 # platform only (Postgres, Redis)
#   .\k8s\deploy.ps1 -Layer 2                 # Kafka + consumers
#   .\k8s\deploy.ps1 -Environment prod        # prod overlay
#   .\k8s\deploy.ps1 -InfraOnly               # layers 0 + 2 (no app images)
#   .\k8s\deploy.ps1 -FabricHostIp 10.0.0.5   # fabric-anchor hostAliases
#   .\k8s\deploy.ps1 -DryRun

param(
    [ValidateSet('dev', 'prod')]
    [string]$Environment = 'dev',
    [int]$Layer = -1,
    [switch]$InfraOnly,
    [switch]$SkipAppImages,
    [switch]$WaitReady,
    [string]$FabricHostIp = '',
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

. (Join-Path $RepoRoot "ops\deploy\lib\Resolve-DeployContext.ps1")

$ctx = Resolve-DeployContext -Environment $Environment -Target 'k8s'
$NS = "roadwatch"
$BASE = "k8s/base"

function kApply([string]$relPath) {
    $full = Join-Path $BASE $relPath
    if (-not (Test-Path $full)) {
        Write-Host "  SKIP (not found): $full" -ForegroundColor DarkYellow
        return
    }
    if ($DryRun) {
        Write-Host "  DRY-RUN: kubectl apply -f $full" -ForegroundColor DarkCyan
        return
    }
    Write-Host "  Applying: $full" -ForegroundColor White
    kubectl apply -f $full --request-timeout=30s
    if ($LASTEXITCODE -ne 0) {
        throw "Failed applying $full"
    }
}

function Wait-Pods([string]$label, [int]$timeout = 120) {
    if ($DryRun) { return }
    Write-Host "  Waiting for pods -l $label (${timeout}s)..." -ForegroundColor Blue
    kubectl wait --for=condition=ready pod -l $label -n $NS --timeout="${timeout}s"
}

function Apply-OverlayConfigPatches {
    if ($DryRun) {
        Write-Host "  DRY-RUN: overlay config patches from k8s/overlays/$Environment" -ForegroundColor DarkCyan
        return
    }
    $overlay = Join-Path $RepoRoot "k8s\overlays\$Environment"
    foreach ($patch in @('configmap-app-patch.yaml', 'configmap-cluster-patch.yaml')) {
        $path = Join-Path $overlay $patch
        if (Test-Path $path) {
            Write-Host "  Patching: $path" -ForegroundColor White
            kubectl apply -f $path
        }
    }
    if ($Environment -eq 'prod') {
        $limits = Join-Path $overlay 'resource-limits-patch.yaml'
        if (Test-Path $limits) { kubectl apply -f $limits }
    }
}

function Apply-Consumers {
    param([string]$fabricIp)
    $path = Join-Path $BASE "layer-2-ingest-hlf/consumers.yaml"
    if (-not (Test-Path $path)) { return }
    if ($DryRun) {
        Write-Host "  DRY-RUN: consumers.yaml (FABRIC_HOST_IP=$fabricIp)" -ForegroundColor DarkCyan
        return
    }
    $yaml = (Get-Content $path -Raw) -replace '172\.17\.0\.1', $fabricIp
    $tmp = [System.IO.Path]::GetTempFileName() + ".yaml"
    Set-Content -Path $tmp -Value $yaml -Encoding UTF8
    try {
        kubectl apply -f $tmp --request-timeout=30s
        if ($LASTEXITCODE -ne 0) { throw "Failed applying consumers.yaml" }
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
}

function Resolve-FabricHostIp {
  if ($FabricHostIp) { return $FabricHostIp }
  $ip = docker inspect "roadwatch-control-plane" `
    --format "{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}" 2>$null |
    Select-Object -First 1
  if ($ip) { return $ip }
  return "172.17.0.1"
}

# Full overlay apply (all layers at once via kustomize)
if ($Layer -eq -1 -and -not $InfraOnly) {
    Write-Host "Full deploy via k8s/overlays/$Environment" -ForegroundColor Cyan
  $ip = Resolve-FabricHostIp
  Invoke-K8sOverlayApply -Context $ctx -FabricHostIp $ip -DryRun:$DryRun
  if ($WaitReady -and -not $DryRun) {
    Wait-Pods "app=postgres" 120
    Wait-Pods "app=gateway" 120
  }
  exit 0
}

$fullDeploy = $Layer -eq -1
$deployApps = -not $SkipAppImages -and -not $InfraOnly

Write-Host "Layer deploy (Layer=$Layer, InfraOnly=$InfraOnly)" -ForegroundColor Cyan

# Layer 0 — Platform
if ($fullDeploy -or $Layer -eq 0 -or $InfraOnly) {
    Write-Host "`n── Layer 0: Platform ──" -ForegroundColor Cyan
    kApply "layer-0-platform/namespace.yaml"
    kApply "layer-0-platform/configmap-infra.yaml"
    kApply "layer-0-platform/configmap-app.yaml"
    kApply "layer-0-platform/configmap-cluster.yaml"
    kApply "layer-0-platform/secret.yaml"
    Apply-OverlayConfigPatches
    if (-not $DryRun -and (Test-Path "docker/postgres/init.sql")) {
        kubectl create configmap postgres-init-sql `
            --from-file=init.sql=docker/postgres/init.sql `
            --namespace $NS --dry-run=client -o yaml | kubectl apply -f -
    } else {
        kApply "layer-0-platform/configmap-postgres-init.yaml"
    }
    kApply "layer-0-platform/postgres.yaml"
    kApply "layer-0-platform/pgbouncer.yaml"
    kApply "layer-0-platform/redis.yaml"
    Wait-Pods "app=postgres" 120
    Wait-Pods "app=redis" 90
    Wait-Pods "app=pgbouncer" 60
}

# Layer 2a — Kafka
if ($fullDeploy -or $Layer -eq 2 -or $InfraOnly) {
    Write-Host "`n── Layer 2: Kafka ──" -ForegroundColor Cyan
    kApply "layer-2-ingest-hlf/configmap-fabric.yaml"
    kApply "layer-2-ingest-hlf/kafka-hlf.yaml"
    kApply "layer-2-ingest-hlf/kafka-events.yaml"
    Wait-Pods "app=zookeeper-hlf" 120
    Wait-Pods "app=kafka-hlf" 180
    Wait-Pods "app=zookeeper-events" 120
    Wait-Pods "app=kafka-events" 180
}

if ($InfraOnly) {
    Write-Host "`nInfraOnly — stopping before app layers." -ForegroundColor Yellow
    exit 0
}

# Layer 1 — API
if (($fullDeploy -or $Layer -eq 1) -and $deployApps) {
    Write-Host "`n── Layer 1: API ──" -ForegroundColor Cyan
    kApply "layer-1-ingest-api/gateway-api.yaml"
    kApply "layer-1-ingest-api/backend-api.yaml"
}

# Layer 2b — Consumers
if (($fullDeploy -or $Layer -eq 2) -and $deployApps) {
    Write-Host "`n── Layer 2: Consumers ──" -ForegroundColor Cyan
    $ip = Resolve-FabricHostIp
    Apply-Consumers -fabricIp $ip
}

# Layer 3 — Scheduler
if (($fullDeploy -or $Layer -eq 3) -and $deployApps) {
    Write-Host "`n── Layer 3: Scheduler ──" -ForegroundColor Cyan
    kApply "layer-3-schedule/scheduler.yaml"
}

# Layer 4 — Frontend
if (($fullDeploy -or $Layer -eq 4) -and $deployApps) {
    Write-Host "`n── Layer 4: Frontend ──" -ForegroundColor Cyan
    kApply "layer-4-presentation/configmap-frontend.yaml"
    kApply "layer-4-presentation/frontend.yaml"
}

if ($WaitReady -and $deployApps -and -not $DryRun) {
    Wait-Pods "app=gateway" 120
    Wait-Pods "app=backend" 120
}

Write-Host "`nDeploy complete." -ForegroundColor Green
