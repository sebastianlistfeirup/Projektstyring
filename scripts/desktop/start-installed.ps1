param([switch]$Stop)
$ErrorActionPreference = 'Stop'
try {
    $state = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installation.json') -Raw | ConvertFrom-Json
    if ($state.current -notmatch '^[a-zA-Z0-9._-]{1,100}$') { throw 'Installationsversionen er ugyldig.' }
    $release = Join-Path $PSScriptRoot "releases\$($state.current)"
    $node = Join-Path $release 'runtime\node.exe'
    $launcher = Join-Path $release 'desktop\launch.mjs'
    if ($Stop) { & $node $launcher --stop }
    else { & $node $launcher }
    exit $LASTEXITCODE
} catch {
    Write-Host "Orbit kunne ikke startes: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
