# Read-only local diagnosis. Do not display credentials or full AI responses.
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
Write-Host 'Orbit - lokal kontrol' -ForegroundColor Cyan
Write-Host "Mappe: $repo"
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = & node --version
    Write-Host "Node.js: $nodeVersion"
} else { Write-Host 'Node.js: mangler (installér Node.js 24 LTS)' -ForegroundColor Red }
if (Get-Command git -ErrorAction SilentlyContinue) {
    $branch = & git -C $repo branch --show-current 2>$null
    $commit = & git -C $repo rev-parse --short HEAD 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Orbit-kode: $branch / $commit"
        $changed = @(& git -C $repo status --porcelain --untracked-files=normal 2>$null)
        if ($changed.Count) { Write-Host "Lokale ændringer: $($changed.Count) - opdatering kræver en ren mappe" -ForegroundColor Yellow }
        else { Write-Host 'Lokale ændringer: ingen' }
    } else { Write-Host 'Git: mappen er ikke et repository' -ForegroundColor Red }
} else { Write-Host 'Git: mangler' -ForegroundColor Red }
if (Test-Path -LiteralPath (Join-Path $repo 'node_modules') -PathType Container) { Write-Host 'Afhængigheder: installeret' }
else { Write-Host 'Afhængigheder: mangler (kør Orbit - Opdater)' -ForegroundColor Yellow }
try {
    $null = Invoke-WebRequest 'http://127.0.0.1:5173/' -TimeoutSec 3 -UseBasicParsing
    Write-Host 'Orbit-vindue: svarer på port 5173'
} catch { Write-Host 'Orbit-vindue: svarer ikke på port 5173' -ForegroundColor Yellow }
try {
    $state = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/swarm' -TimeoutSec 3
    Write-Host 'Companion: svarer på port 4310'
    if ($state.run) { Write-Host "Seneste kørsel: $($state.run.status)" }
    if ($state.processes.Count) { Write-Host "Aktive AI-processer: $($state.processes.Count)" }
    if ($state.permissions.Count) { Write-Host "Afventer beslutninger: $($state.permissions.Count)" }
} catch { Write-Host 'Companion: svarer ikke på port 4310' -ForegroundColor Yellow }
Write-Host 'Denne kontrol ændrede ingen projektfiler og foretog ingen AI-kald.'
