# stop-all.ps1 - Stop all RoadWatch services
# Usage: .\stop-all.ps1

Write-Host "🛑 Stopping RoadWatch Services..." -ForegroundColor White
Write-Host ""

# Helper: kill a process by its saved PID file
function Stop-ServiceByPid {
    param(
        [string]$Name,
        [string]$PidFile,
        [string]$Color
    )

    if (Test-Path $PidFile) {
        $savedPid = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $savedPid -Force
                Write-Host "✓ Stopped $Name (PID: $savedPid)" -ForegroundColor $Color
            } else {
                Write-Host "  $Name was not running (stale PID: $savedPid)" -ForegroundColor Gray
            }
        }
        Remove-Item $PidFile -Force
    } else {
        Write-Host "  No PID file found for $Name — skipping" -ForegroundColor Gray
    }
}

# Stop Frontend
Write-Host "🌐 Stopping Frontend..." -ForegroundColor Blue
Stop-ServiceByPid -Name "Frontend" -PidFile ".pids\frontend.pid" -Color "Magenta"
Write-Host ""

# Stop Gateway API
Write-Host "🔌 Stopping Gateway API..." -ForegroundColor Blue
Stop-ServiceByPid -Name "Gateway API" -PidFile ".pids\gateway-api.pid" -Color "Cyan"
Write-Host ""

# Stop Fabric window (the WSL script runs to completion on its own,
# but we close the terminal window if it is still open)
Write-Host "⛓️  Stopping Hyperledger Fabric window..." -ForegroundColor Blue
Stop-ServiceByPid -Name "Fabric (WSL)" -PidFile ".pids\fabric.pid" -Color "Green"
Write-Host ""

# Stop Docker infrastructure
Write-Host "📦 Stopping Docker services (PostgreSQL, Kafka, Redis, Zookeeper)..." -ForegroundColor Blue
docker-compose stop
Write-Host "✓ Docker services stopped" -ForegroundColor Green
Write-Host ""

# Clean up empty .pids directory
if ((Test-Path .pids) -and (-not (Get-ChildItem .pids))) {
    Remove-Item .pids -Force
}

Write-Host ("━" * 62) -ForegroundColor Red
Write-Host "✅ All RoadWatch services stopped." -ForegroundColor Green
Write-Host ("━" * 62) -ForegroundColor Red
Write-Host ""
Write-Host "💡 To start again:" -ForegroundColor Yellow
Write-Host "  .\start-all.ps1"
Write-Host ""