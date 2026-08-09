# Shared path helpers for deploy/dev scripts.

function Convert-ToWslPath {
    param([string]$Path)
    $resolved = (Resolve-Path $Path).Path
    if ($resolved -match '^([A-Za-z]):\\(.*)$') {
        return "/mnt/$($Matches[1].ToLower())/$($Matches[2] -replace '\\','/')"
    }
    return $resolved
}

function Get-RepoWslPath {
    param([string]$RepoRoot = (Get-Location).Path)
    return Convert-ToWslPath $RepoRoot
}

function Test-FabricK8sCertsPresent {
    param([string]$RepoRoot = (Get-Location).Path)
    $tls  = Join-Path $RepoRoot "fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\peers\peer0.nhai.roadwatch.com\tls\ca.crt"
    $cert = Join-Path $RepoRoot "fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\users\Admin@nhai.roadwatch.com\msp\signcerts\cert.pem"
    $key  = Join-Path $RepoRoot "fabric\network\organizations\peerOrganizations\nhai.roadwatch.com\users\Admin@nhai.roadwatch.com\msp\keystore\priv_sk"
    return ((Test-Path $tls) -and (Test-Path $cert) -and (Test-Path $key))
}

function Test-DockerReady {
    try {
        docker info 2>&1 | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-WslDistro {
    $distros = @(wsl --list --quiet 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($distros -contains 'Ubuntu') { return 'Ubuntu' }
    if ($distros.Count -gt 0) { return $distros[0] }
    return 'Ubuntu'
}

function Write-UnixScript {
    param([string]$Path, [string]$Content)
    $lf = ($Content -replace "`r`n", "`n") -replace "`r", "`n"
    $dir = Split-Path -Parent $Path
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($Path, $lf, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-WslBash {
    <#
    Runs a bash script in WSL via a temp file with LF line endings.
    Avoids CRLF and Windows PATH injection bugs from inline bash -lc strings.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Script,
        [string]$Distro = ''
    )

    if (-not $Distro) { $Distro = Get-WslDistro }
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "roadwatch-wsl"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $tempFile = Join-Path $tempDir ("rw-{0}.sh" -f [guid]::NewGuid().ToString('n').Substring(0, 8))
    Write-UnixScript -Path $tempFile -Content $Script
    $wslPath = Convert-ToWslPath $tempFile
    try {
        wsl -d $Distro -- bash -lc "bash '$wslPath'"
        return $LASTEXITCODE
    } finally {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
}
