# ops/dev/verify-bootstrap.ps1 — Validate a fresh-clone bootstrap (no full deploy)
# Usage: .\ops\dev\verify-bootstrap.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

$failed = 0

function Check([string]$Name, [scriptblock]$Test) {
    Write-Host "  $Name ... " -NoNewline
    try {
        & $Test
        if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "exit $LASTEXITCODE" }
        Write-Host "OK" -ForegroundColor Green
    } catch {
        Write-Host "FAIL" -ForegroundColor Red
        Write-Host "    $_" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host "Bootstrap verification" -ForegroundColor Cyan

Check "setup.ps1 (dry bootstrap)" {
    & (Join-Path $RepoRoot "ops\dev\setup.ps1") -SkipInstall -KubernetesOnly
}

Check "kustomize dev overlay" {
    kubectl kustomize k8s/overlays/dev --load-restrictor LoadRestrictionsNone | Out-Null
}

Check "docker compose config" {
    docker compose config | Out-Null
}

Check "fabric network .env.example" {
    if (-not (Test-Path "fabric\network\.env.example")) { throw "missing" }
}

Check "start-all.ps1 parses" {
    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $RepoRoot "ops\dev\start-all.ps1"),
        [ref]$null,
        [ref]$parseErrors
    )
    if ($parseErrors -and $parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
}

Write-Host ""
if ($failed -eq 0) {
    Write-Host "All checks passed." -ForegroundColor Green
    exit 0
}
Write-Host "$failed check(s) failed." -ForegroundColor Red
exit 1
