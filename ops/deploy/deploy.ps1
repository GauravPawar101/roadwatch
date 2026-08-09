#!/usr/bin/env pwsh
# ops/deploy/deploy.ps1 — Deployment router
#
# Choose WHERE to deploy (target) and WHAT subset (layer flags).
# Infra is district-agnostic — state/national scope is app data, not k8s manifests.
#
# Usage:
#   .\ops\deploy\deploy.ps1 -Target local
#   .\ops\deploy\deploy.ps1 -Target kind
#   .\ops\deploy\deploy.ps1 -Target kind -Layer 0
#   .\ops\deploy\deploy.ps1 -Target kind -InfraOnly
#   .\ops\deploy\deploy.ps1 -Target k8s -Environment prod -Layer 2
#   .\ops\deploy\deploy.ps1 -Target aws -Environment prod

param(
    [ValidateSet('local', 'kind', 'k8s', 'aws')]
    [string]$Target = 'local',

    [ValidateSet('dev', 'prod')]
    [string]$Environment = 'dev',

    # Optional — local demo seed only, not used by k8s infra
    [string]$DistrictId = '',
    [string]$DistrictCode = '',

    # local
    [switch]$StartApps,
    [switch]$SkipSeed,
    [switch]$SkipFabric,

    # kind / k8s
    [switch]$Reset,
    [switch]$SkipBuild,
    [switch]$InfraOnly,
    [switch]$SkipFabricCerts,
    [int]$Layer = -1,
    [switch]$WaitReady,
    [switch]$SkipAppImages,
    [switch]$DryRun,

    # aws
    [string]$AwsRegion = '',
    [string]$EksCluster = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $RepoRoot

. (Join-Path $PSScriptRoot 'lib\Resolve-DeployContext.ps1')

$ctx = Resolve-DeployContext -DistrictId $DistrictId -DistrictCode $DistrictCode -Environment $Environment -Target $Target
Write-DeployContext $ctx

$targetScript = Join-Path $PSScriptRoot "targets\$Target.ps1"
if (-not (Test-Path $targetScript)) {
    throw "Deploy target script not found: $targetScript"
}

& $targetScript @PSBoundParameters -Context $ctx
