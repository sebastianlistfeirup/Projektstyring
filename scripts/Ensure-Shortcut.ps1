# Orbit – selvhelende skrivebordsgenvej
# Kaldes af Start-Orbit.bat ved hver start. Sikrer at "Orbit.lnk" findes på
# skrivebordet og peger på den rigtige Start-Orbit.bat (også hvis brugeren
# har flyttet mappen, fået nyt skrivebord via OneDrive osv.).
param([string]$BatPath = "")
try {
  if (-not $BatPath) { exit 0 }
  if (-not (Test-Path -LiteralPath $BatPath -PathType Leaf)) { exit 0 }
  $BatPath = (Resolve-Path -LiteralPath $BatPath).ProviderPath
  $workingDirectory = Split-Path $BatPath
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { exit 0 }
  $lnk = Join-Path $desktop 'Orbit.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $ok = $false
  if (Test-Path $lnk) {
    try {
      $s = $shell.CreateShortcut($lnk)
      # En anden Orbit-installation kan have samme filnavn. Genbrug kun
      # genvejen, hvis den starter netop den installation, der reparerer den.
      $target = $s.TargetPath
      $ok = ($target -ieq $BatPath) -and
            [string]::IsNullOrWhiteSpace($s.Arguments) -and
            ($s.WorkingDirectory -ieq $workingDirectory)
    } catch { $ok = $false }
  }
  if (-not $ok) {
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $BatPath
    $sc.Arguments = ''
    $sc.WorkingDirectory = $workingDirectory
    $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
    $sc.Description = 'Orbit – projektstyring'
    $sc.Save()
    Write-Host "Orbit-genvejen blev oprettet/repareret: $lnk"
  }
} catch { }
exit 0
