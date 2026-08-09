# k8s.ps1 — existing cluster (EKS, GKE, on-prem)

param(
    $Context,
    [int]$Layer = -1,
    [switch]$InfraOnly,
    [switch]$SkipAppImages,
    [switch]$WaitReady,
    [string]$FabricHostIp = '',
    [switch]$DryRun
)

Write-Host "K8S — apply manifests to current kubectl context" -ForegroundColor Cyan

$deployParams = @{ Environment = $Context.Environment }
if ($Layer -ge 0) { $deployParams.Layer = $Layer }
if ($InfraOnly) { $deployParams.InfraOnly = $true }
if ($SkipAppImages) { $deployParams.SkipAppImages = $true }
if ($WaitReady) { $deployParams.WaitReady = $true }
if ($FabricHostIp) { $deployParams.FabricHostIp = $FabricHostIp }
if ($DryRun) { $deployParams.DryRun = $true }

& (Join-Path $RepoRoot 'k8s\deploy.ps1') @deployParams
