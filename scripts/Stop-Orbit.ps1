param([switch]$RefuseActive)
$ErrorActionPreference = 'Stop'
try {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(4310, 5173) })
    if ($listeners.LocalPort -contains 4310) {
        # A reachable control endpoint is required before touching processes.
        $state = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/swarm' -TimeoutSec 5
        if ($state.run.status -in @('running', 'awaiting_approval')) {
            if ($RefuseActive) { throw 'En AI-koersel er aktiv. Afslut eller stop den i Orbit foer opdatering.' }
            $runId = [uri]::EscapeDataString($state.run.runId)
            Invoke-RestMethod "http://127.0.0.1:4310/api/ai/runs/$runId/cancel" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
            $deadline = (Get-Date).AddSeconds(25)
            do {
                Start-Sleep -Milliseconds 300
                $state = Invoke-RestMethod 'http://127.0.0.1:4310/api/ai/swarm' -TimeoutSec 5
            } while (($state.run.status -in @('running', 'awaiting_approval')) -and (Get-Date) -lt $deadline)
            if ($state.run.status -in @('running', 'awaiting_approval')) { throw 'Koerslen er endnu ikke stoppet. Processerne er bevaret; se Orbit Live.' }
        }
    }
    foreach ($processId in ($listeners.OwningProcess | Sort-Object -Unique)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
        if (-not $process) { continue }
        if ($process.CommandLine -notmatch '(companion\.mjs|vite[\\/]|vite\.js)') {
            throw "Porten ejes af en ukendt proces ($processId). Den bliver ikke stoppet."
        }
        & taskkill /PID $processId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Kunne ikke stoppe proces $processId." }
    }
    Write-Host 'Orbit er stoppet. Gemte AI-koersler og leverancer er bevaret.'
    exit 0
} catch {
    Write-Host "Orbit blev ikke stoppet: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
