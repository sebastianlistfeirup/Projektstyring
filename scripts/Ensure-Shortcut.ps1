# Orbit – selvhelende skrivebordsgenvej
# Kaldes af Start-Orbit.bat ved hver start. Sikrer at "Orbit.lnk" findes på
# skrivebordet og peger på den rigtige Start-Orbit.bat (også hvis brugeren
# har flyttet mappen, fået nyt skrivebord via OneDrive osv.).
param([string]$BatPath = "")
try {
  if (-not $BatPath) { exit 0 }
  if (-not (Test-Path $BatPath)) { exit 0 }
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { exit 0 }
  $lnk = Join-Path $desktop 'Orbit.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $ok = $false
  if (Test-Path $lnk) {
    try {
      $s = $shell.CreateShortcut($lnk)
      # Genbrug kun genvejen, hvis den peger på en eksisterende Start-Orbit.bat
      $target = $s.TargetPath
      if ($target -and (Test-Path $target) -and $target -like '*Start-Orbit.bat*') { $ok = $true }
      if (-not $ok -and $s.Arguments -like '*Start-Orbit.bat*') {
        $m = [regex]::Match($s.Arguments, '"([^"]*Start-Orbit\.bat)"')
        if ($m.Success -and (Test-Path $m.Groups[1].Value)) { $ok = $true }
      }
    } catch { $ok = $false }
  }
  if (-not $ok) {
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $BatPath
    $sc.WorkingDirectory = Split-Path $BatPath
    $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
    $sc.Description = 'Orbit – projektstyring'
    $sc.Save()
    Write-Host "Orbit-genvejen blev oprettet/repareret: $lnk"
  }
} catch { }
exit 0
