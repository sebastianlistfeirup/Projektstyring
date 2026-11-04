# The preview is an explicit choice. Never replace local commits, files or an
# active AI run merely because the user clicked the desktop update shortcut.
$ErrorActionPreference = 'Stop'
$branch = 'codex/orbit-reliable-autonomy'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
function Invoke-Git([string[]]$arguments) {
    $output = & git -C $repo @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Git kunne ikke gennemføre '$($arguments -join ' ')': $($output -join ' ')" }
    return ($output -join "`n")
}
function Test-Idle($state) {
    if (-not $state -or -not $state.ok) { return $false }
    if ($state.run -and $state.run.status -in @('running', 'awaiting_approval', 'interrupted')) { return $false }
    return (($state.processes.Count -eq 0) -and ($state.permissions.Count -eq 0))
}
try {
    $null = Invoke-Git -arguments @('rev-parse', '--show-toplevel')
    $changes = Invoke-Git -arguments @('status', '--porcelain', '--untracked-files=normal')
    if (-not [string]::IsNullOrWhiteSpace($changes)) { throw 'Der er lokale ændringer i Orbit-mappen. Gem dem først; intet er overskrevet.' }
    Write-Host 'Henter den valgte Orbit-version...'
    $null = Invoke-Git -arguments @('fetch', 'origin', "refs/heads/${branch}:refs/remotes/origin/${branch}")
    $remote = (Invoke-Git -arguments @('rev-parse', "refs/remotes/origin/$branch")).Trim()
    $current = (Invoke-Git -arguments @('rev-parse', 'HEAD')).Trim()
    & git -C $repo merge-base --is-ancestor $current $remote
    if ($LASTEXITCODE -ne 0) { throw 'Den nuværende Orbit-gren har egne commits uden for opdateringen. Ingen gren er skiftet.' }
    & git -C $repo show-ref --verify --quiet "refs/heads/$branch"
    $localExists = $LASTEXITCODE -eq 0
    if ($localExists) {
        $local = (Invoke-Git -arguments @('rev-parse', "refs/heads/$branch")).Trim()
        & git -C $repo merge-base --is-ancestor $local $remote
        if ($LASTEXITCODE -ne 0) { throw 'Den lokale Orbit-opdateringsgren har egne commits. Intet er overskrevet.' }
    }
    # A deliberately paused queue must remain paused. If Companion is offline,
    # the old queue state is unknown, so leave it paused after the update.
    $queueBefore = $null
    $swarmBefore = $null
    try {
        $queueBefore = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/queue' -TimeoutSec 5
        $swarmBefore = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/swarm' -TimeoutSec 5
    } catch { }
    if ($swarmBefore -and (($swarmBefore.run -and $swarmBefore.run.status -in @('running', 'awaiting_approval')) -or
                           $swarmBefore.processes.Count -gt 0 -or $swarmBefore.permissions.Count -gt 0)) {
        throw 'En AI-kørsel eller beslutning er stadig aktiv. Afslut den i Orbit før opdatering.'
    }
    $wasUnpaused = $queueBefore -and $queueBefore.ok -and $queueBefore.queue.paused -eq $false -and
                   -not $queueBefore.queue.storageError -and (Test-Idle $swarmBefore) -and
                   (@($queueBefore.queue.entries | Where-Object { $_.status -in @('running', 'interrupted') }).Count -eq 0)
    $entryBefore = @($queueBefore.queue.entries | ForEach-Object { "$($_.id):$($_.status)" }) -join '|'
    & (Join-Path $PSScriptRoot 'Stop-Orbit.ps1') -RefuseActive
    if ($LASTEXITCODE -ne 0) { throw 'En aktiv Orbit-kørsel skal afsluttes før opdatering. Arbejdet er bevaret.' }
    $changes = Invoke-Git -arguments @('status', '--porcelain', '--untracked-files=normal')
    $unchangedHead = (Invoke-Git -arguments @('rev-parse', 'HEAD')).Trim()
    if (-not [string]::IsNullOrWhiteSpace($changes) -or $unchangedHead -ne $current) {
        throw 'Orbit-mappen ændrede sig under opdateringen. Ingen gren er skiftet.'
    }
    if ($localExists) { $null = Invoke-Git -arguments @('switch', $branch) }
    else { $null = Invoke-Git -arguments @('switch', '-c', $branch, '--track', "origin/$branch") }
    $null = Invoke-Git -arguments @('branch', '--set-upstream-to', "origin/$branch", $branch)
    & (Join-Path $PSScriptRoot 'Install-Orbit.bat')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($wasUnpaused) {
        try {
            $ping = Invoke-RestMethod 'http://127.0.0.1:4310/api/ping' -TimeoutSec 5
            $queueAfter = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/queue' -TimeoutSec 5
            $swarmAfter = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/swarm' -TimeoutSec 5
            $entryAfter = @($queueAfter.queue.entries | ForEach-Object { "$($_.id):$($_.status)" }) -join '|'
            $safeToResume = $ping.ok -and $queueAfter.ok -and $queueAfter.queue.paused -eq $true -and
                            -not $queueAfter.queue.storageError -and
                            $queueAfter.queue.reason -in @('Companion lukkes. Fortsæt køen, når Orbit er startet igen.', 'Køen er sat på pause. Den aktive kørsel fortsætter.') -and
                            $entryAfter -eq $entryBefore -and (Test-Idle $swarmAfter) -and
                            (@($queueAfter.queue.entries | Where-Object { $_.status -in @('running', 'interrupted') }).Count -eq 0)
            if ($safeToResume) {
                $result = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/queue/control' -Method Post -ContentType 'application/json' -Body '{"action":"resume"}' -TimeoutSec 5
                if ($result.ok -and -not $result.queue.paused) { Write-Host 'Arbejdskøen fortsætter, som før opdateringen.'; exit 0 }
            }
        } catch { }
        Write-Host 'Arbejdskøen står på pause. Gennemgå den i Orbit Live og vælg Fortsæt køen, når arbejdet er klar.' -ForegroundColor Yellow
    } else {
        Write-Host 'Køens tidligere tilstand var sat på pause eller kunne ikke bekræftes. Gennemgå køen i Orbit Live før fortsættelse.' -ForegroundColor Yellow
    }
    exit 0
} catch {
    Write-Host "Orbit blev ikke opdateret: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
