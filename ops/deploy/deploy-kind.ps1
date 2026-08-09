# ops/deploy/deploy-kind.ps1 — kind cluster + image build + layered k8s apply
#
# Usage:
#   .\ops\deploy\deploy-kind.ps1
#   .\ops\deploy\deploy-kind.ps1 -Reset -Environment dev
#   .\ops\deploy\deploy-kind.ps1 -Layer 0
#   .\ops\deploy\deploy-kind.ps1 -InfraOnly
#   .\ops\deploy\deploy-kind.ps1 -SkipFabricCerts

param(
    [switch]$Reset,
    [switch]$SkipBuild,
    [switch]$InfraOnly,
    [switch]$SkipFabricCerts,
    [ValidateSet('dev', 'prod')]
    [string]$Environment = 'dev',
    [int]$Layer = -1,
    [switch]$WaitReady,
    [switch]$SkipAppImages
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

$CLUSTER_NAME = "roadwatch"

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host ("━" * 64) -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host ("━" * 64) -ForegroundColor Cyan
}

if ($Reset) {
    Write-Step "Deleting kind cluster '$CLUSTER_NAME'..."
    kind delete cluster --name $CLUSTER_NAME 2>$null
}

Write-Step "Creating kind cluster '$CLUSTER_NAME'..."
$existing = kind get clusters 2>$null | Where-Object { $_ -eq $CLUSTER_NAME }
if ($existing) {
    Write-Host "  Cluster exists — skipping creation." -ForegroundColor Yellow
} else {
    kind create cluster --name $CLUSTER_NAME --config k8s\kind-config.yaml
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
kubectl config use-context "kind-$CLUSTER_NAME"

. (Join-Path $PSScriptRoot "lib\Resolve-DeployContext.ps1")
$viteApiBase = Get-FrontendBuildApiBase

if (-not $SkipBuild -and -not $InfraOnly -and -not $SkipAppImages) {
    Write-Step "Building Docker images..."
    $builds = @(
        @{ tag = "roadwatch/gateway-api:local";             file = "apps\gateway-api\Dockerfile"; args = @() },
        @{ tag = "roadwatch/backend-api:local";             file = "backend-api\Dockerfile"; args = @() },
        @{ tag = "roadwatch/frontend:local";                file = "frontend\Dockerfile"; args = @("--build-arg", "VITE_API_BASE=$viteApiBase") },
        @{ tag = "roadwatch/scheduler:local";               file = "services\scheduler\Dockerfile"; args = @() },
        @{ tag = "roadwatch/webhook-handler:local";         file = "services\webhook-handler\Dockerfile"; args = @() },
        @{ tag = "roadwatch/fabric-anchor-consumer:local"; file = "services\fabric-anchor-consumer\Dockerfile"; args = @() }
    )
    foreach ($b in $builds) {
        if (-not (Test-Path $b.file)) { continue }
        Write-Host "  → $($b.tag)" -ForegroundColor White
        docker build -t $b.tag -f $b.file @($b.args) .
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }
}

if (-not $InfraOnly -and -not $SkipAppImages) {
    Write-Step "Loading images into kind..."
    foreach ($img in @(
        "roadwatch/gateway-api:local", "roadwatch/backend-api:local", "roadwatch/frontend:local",
        "roadwatch/scheduler:local", "roadwatch/webhook-handler:local", "roadwatch/fabric-anchor-consumer:local"
    )) {
        if (docker image inspect $img 2>$null) {
            kind load docker-image $img --name $CLUSTER_NAME
        }
    }
}

if (-not $SkipFabricCerts) {
    Write-Step "Fabric certs Secret..."
    $tls  = "fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\peers\peer0.nhai.roadwatch.com\tls\ca.crt"
    $cert = "fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\users\Admin@nhai.roadwatch.com\msp\signcerts\cert.pem"
    $key  = "fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\users\Admin@nhai.roadwatch.com\msp\keystore\priv_sk"
    if ((Test-Path $tls) -and (Test-Path $cert) -and (Test-Path $key)) {
        kubectl create namespace roadwatch --dry-run=client -o yaml | kubectl apply -f - | Out-Null
        kubectl create secret generic fabric-certs `
            --from-file=tls-ca.crt=$tls --from-file=msp-cert.pem=$cert --from-file=msp-key.pem=$key `
            --namespace roadwatch --dry-run=client -o yaml | kubectl apply -f -
    } else {
        Write-Host "  Certs not found — use -SkipFabricCerts or start Fabric network first." -ForegroundColor Yellow
    }
}

Write-Step "Applying manifests (k8s/deploy.ps1)..."
$deployArgs = @('-Environment', $Environment)
if ($Layer -ge 0) { $deployArgs += '-Layer', $Layer }
if ($InfraOnly) { $deployArgs += '-InfraOnly' }
if ($SkipAppImages) { $deployArgs += '-SkipAppImages' }
if ($WaitReady) { $deployArgs += '-WaitReady' }
& (Join-Path $RepoRoot 'k8s\deploy.ps1') @deployArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "  Frontend: http://localhost:30080" -ForegroundColor Green
Write-Host "  Gateway:  http://localhost:30100" -ForegroundColor Green
Write-Host "  Backend:  http://localhost:30401" -ForegroundColor Green
