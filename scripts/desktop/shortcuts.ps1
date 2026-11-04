param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
$state = Get-Content -LiteralPath (Join-Path $InstallDir 'installation.json') -Raw | ConvertFrom-Json
if ($state.current -notmatch '^[a-zA-Z0-9._-]{1,100}$') { throw 'Ugyldigt release-id.' }
$shell = New-Object -ComObject WScript.Shell
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')
$icon = Join-Path $InstallDir "releases\$($state.current)\runtime\orbit.ico"
foreach ($folder in @($desktop, $programs)) {
    $shortcut = $shell.CreateShortcut((Join-Path $folder 'Orbit.lnk'))
    $shortcut.TargetPath = Join-Path $InstallDir 'Start-Orbit.cmd'
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.IconLocation = $icon
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Orbit - samlet arbejdsflade'
    $shortcut.Save()
}
$stop = $shell.CreateShortcut((Join-Path $programs 'Orbit - Stop.lnk'))
$stop.TargetPath = Join-Path $InstallDir 'Stop-Orbit.cmd'
$stop.WorkingDirectory = $InstallDir
$stop.IconLocation = $icon
$stop.WindowStyle = 7
$stop.Save()
