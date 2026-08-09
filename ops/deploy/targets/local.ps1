# local.ps1 — Docker Compose infrastructure + optional app startup

param(
    $Context,
    [switch]$StartApps,
    [switch]$SkipSeed,
    [switch]$SkipFabric
)

Write-Host "LOCAL deploy — Docker Compose on host" -ForegroundColor Cyan

Write-Host "  Starting Postgres, Redis, Kafka (HLF + Events)..." -ForegroundColor White
docker compose up -d

Write-Host "  Waiting for PgBouncer (16432)..." -ForegroundColor White
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    try {
        $c = [System.Net.Sockets.TcpClient]::new()
        $iar = $c.BeginConnect('127.0.0.1', 16432, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(500)) {
            $c.EndConnect($iar)
            $c.Close()
            break
        }
        $c.Close()
    } catch { }
    Start-Sleep -Seconds 2
}

if (-not $SkipSeed) {
    Write-Host "  Seeding demo data for district $($Context.DistrictCode)..." -ForegroundColor White
    pnpm seed:demo
}

Write-Host ""
Write-Host "  Local infrastructure ready" -ForegroundColor Green
Write-Host "    PgBouncer:    127.0.0.1:16432"
Write-Host "    Redis:        127.0.0.1:16379"
Write-Host "    Kafka HLF:    127.0.0.1:9094"
Write-Host "    Kafka Events: 127.0.0.1:9095"
Write-Host "    District:     $($Context.DistrictName) ($($Context.DistrictCode))"
Write-Host ""

if ($StartApps) {
    $startArgs = @('-DistrictCode', $Context.DistrictCode, '-DistrictId', $Context.DistrictId, '-Environment', $Context.Environment)
    if ($SkipFabric) { $startArgs += '-SkipFabric' }
    & (Join-Path $RepoRoot 'ops\dev\start-all.ps1') @startArgs
} else {
    Write-Host "  Next: pnpm dev" -ForegroundColor Yellow
    Write-Host "    or: .\ops\deploy\deploy.ps1 -Target local -StartApps -DistrictCode $($Context.DistrictCode)" -ForegroundColor Yellow
}
