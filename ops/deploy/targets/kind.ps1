# kind.ps1 — local Kubernetes via kind

param(
    $Context,
    [switch]$Reset,
    [switch]$SkipBuild,
    [switch]$InfraOnly,
    [switch]$SkipFabricCerts,
    [int]$Layer = -1,
    [switch]$WaitReady,
    [switch]$SkipAppImages
)

Write-Host "KIND — build images, create cluster, apply manifests" -ForegroundColor Cyan

$kindParams = @{ Environment = $Context.Environment }
if ($Reset) { $kindParams.Reset = $true }
if ($SkipBuild) { $kindParams.SkipBuild = $true }
if ($InfraOnly) { $kindParams.InfraOnly = $true }
if ($SkipFabricCerts) { $kindParams.SkipFabricCerts = $true }
if ($Layer -ge 0) { $kindParams.Layer = $Layer }
if ($WaitReady) { $kindParams.WaitReady = $true }
if ($SkipAppImages) { $kindParams.SkipAppImages = $true }

& (Join-Path $RepoRoot 'ops\deploy\deploy-kind.ps1') @kindParams
