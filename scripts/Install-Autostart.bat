@echo off
chcp 65001 >nul
rem ============================================================
rem  Orbit – Installér autostart
rem  Opretter en genvej til Start-Orbit.bat i brugerens
rem  opstartsmappe, så Orbit starter automatisk ved login.
rem ============================================================
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Orbit.lnk"
set "BAT=%~dp0Start-Orbit.bat"
set "BATDIR=%~dp0"
set "DESC=Orbit - Projektstyring"

if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup" (
  mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut($env:LNK); $s.TargetPath = $env:BAT; $s.WorkingDirectory = $env:BATDIR; $s.WindowStyle = 7; $s.Description = $env:DESC; $s.Save()"

if errorlevel 1 (
  echo FEJL: Kunne ikke oprette genvejen.
  exit /b 1
)
echo Genvej oprettet: %LNK%
echo Orbit starter nu automatisk ved næste login.
