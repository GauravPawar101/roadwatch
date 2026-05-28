# start.ps1 - Compatibility wrapper for the RoadWatch launcher
# Usage: .\start.ps1

$scriptPath = Join-Path $PSScriptRoot 'start-all.ps1'
if (-not (Test-Path $scriptPath)) {
    throw "Missing launcher: $scriptPath"
}

& $scriptPath @args
