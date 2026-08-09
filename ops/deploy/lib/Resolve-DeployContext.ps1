# Resolves deploy context for ops/deploy scripts.
# Infrastructure (k8s) is district-agnostic — state/national scope is data + app config, not manifests.

function Get-DistrictCatalog {
    $catalogPath = Join-Path $RepoRoot "config\deploy\districts.json"
    if (-not (Test-Path $catalogPath)) {
        throw "District catalog not found: $catalogPath"
    }
    return Get-Content $catalogPath -Raw | ConvertFrom-Json
}

function Resolve-DeployContext {
    param(
        [string]$DistrictId = '',
        [string]$DistrictCode = '',
        [ValidateSet('dev', 'prod')]
        [string]$Environment = 'dev',
        [ValidateSet('local', 'kind', 'k8s', 'aws')]
        [string]$Target = 'local'
    )

    $ctx = [ordered]@{
        Target       = $Target
        Environment  = $Environment
        K8sOverlay   = $Environment
        K8sNamespace = 'roadwatch'
        DistrictId   = ''
        DistrictCode = ''
        DistrictName = ''
    }

    # District is optional — only used for local demo seeding, not k8s infra.
    if ($DistrictId -or $DistrictCode) {
        $catalog = Get-DistrictCatalog
        $code = if ($DistrictCode) { $DistrictCode.ToUpper() } else { $catalog.default }
        $entry = $catalog.districts.$code
        if (-not $entry -and -not $DistrictId) {
            $known = ($catalog.districts.PSObject.Properties.Name -join ', ')
            throw "Unknown DistrictCode '$code'. Known codes: $known"
        }
        $ctx.DistrictId   = if ($DistrictId) { $DistrictId } else { [string]$entry.id }
        $ctx.DistrictCode = if ($DistrictId -and -not $DistrictCode) { 'CUSTOM' } else { $code }
        $ctx.DistrictName = if ($entry) { [string]$entry.name } else { 'Custom District' }
    }

    return [pscustomobject]$ctx
}

function Write-DeployContext {
    param($Context)
    Write-Host ""
    Write-Host "Deploy context" -ForegroundColor Cyan
    Write-Host "  Target:      $($Context.Target)" -ForegroundColor White
    Write-Host "  Environment: $($Context.Environment)" -ForegroundColor White
    Write-Host "  K8s overlay: k8s/overlays/$($Context.K8sOverlay)" -ForegroundColor White
    if ($Context.DistrictCode) {
        Write-Host "  District:    $($Context.DistrictName) ($($Context.DistrictCode)) [local seed only]" -ForegroundColor White
    }
    Write-Host ""
}

function Get-K8sOverlayPath {
    param($Context)
    $path = Join-Path $RepoRoot "k8s\overlays\$($Context.K8sOverlay)"
    if (-not (Test-Path (Join-Path $path "kustomization.yaml"))) {
        throw "K8s overlay not found: $path"
    }
    return $path
}

function New-K8sOverlayStagingDir {
    param(
        $Context,
        [string]$FabricHostIp = ''
    )

    $source = Get-K8sOverlayPath -Context $Context
    $staging = Join-Path ([System.IO.Path]::GetTempPath()) "roadwatch-k8s-$([guid]::NewGuid().ToString('n').Substring(0, 8))"
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination $staging -Recurse -Force

    if ($FabricHostIp) {
        $clusterPatch = Join-Path $staging 'configmap-cluster-patch.yaml'
        if (Test-Path $clusterPatch) {
            $yaml = Get-Content $clusterPatch -Raw
            $yaml = $yaml -replace 'FABRIC_HOST_IP:\s*"[^"]*"', "FABRIC_HOST_IP: `"$FabricHostIp`""
            Set-Content -Path $clusterPatch -Value $yaml -Encoding UTF8 -NoNewline
        }
    }

    return $staging
}

function Get-FrontendBuildApiBase {
    $basePath = Join-Path $RepoRoot 'k8s\base\layer-4-presentation\configmap-frontend.yaml'
    if (Test-Path $basePath) {
        $content = Get-Content $basePath -Raw
        if ($content -match 'VITE_API_BASE:\s*"(.+)"') {
            return $Matches[1]
        }
    }
    return 'http://localhost:30100'
}

function Invoke-K8sOverlayApply {
    param(
        $Context,
        [string]$FabricHostIp = '',
        [switch]$DryRun
    )

    $staging = New-K8sOverlayStagingDir -Context $Context -FabricHostIp $FabricHostIp
    try {
        Write-Host "  Applying k8s/overlays/$($Context.K8sOverlay)" -ForegroundColor White
        if ($FabricHostIp) {
            Write-Host "  FABRIC_HOST_IP: $FabricHostIp" -ForegroundColor Green
        }
        if ($DryRun) {
            kubectl kustomize $staging --load-restrictor LoadRestrictionsNone
            return
        }
        kubectl apply -k $staging --load-restrictor LoadRestrictionsNone
        if ($LASTEXITCODE -ne 0) {
            throw "kubectl apply -k failed for overlay $($Context.K8sOverlay)"
        }
    } finally {
        Remove-Item -Path $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}
