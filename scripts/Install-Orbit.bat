@echo off
chcp 65001 >nul
rem ============================================================
rem  Orbit – én-klik installér/opdatér og start
rem  Henter nyeste version (AI-værksted-branchen), installerer
rem  afhængigheder hvis nødvendigt og starter app + companion.
rem  Dobbeltklik på denne fil. Kræver git og Node.js 22.13+ (24 LTS anbefales).
rem ============================================================
cd /d "%~dp0.."
title Orbit – installerer og starter...

rem Opdater aldrig afhængigheder under en aktiv AI-koersel.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Orbit.ps1" -RefuseActive
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo === Henter nyeste version fra GitHub... ===
git fetch origin
if errorlevel 1 (
  echo ADVARSEL: Kunne ikke hente fra GitHub ^(måske offline?^).
  echo Fortsætter med den version, der allerede ligger på computeren...
) else (
  rem Bevar den valgte branch, og overskriv aldrig lokale commits.
  git pull --ff-only
  if errorlevel 1 (
    echo FEJL: Branchen kunne ikke opdateres automatisk. Dine lokale aendringer er bevaret.
    pause
    exit /b 1
  )
)

echo.
echo === Installerer afhængigheder... ===
call npm ci
if errorlevel 1 (
  echo FEJL: Afhængighederne kunne ikke installeres. Kontrollér Node.js-version og netværk.
  pause
  exit /b 1
)

echo.
echo === Starter Orbit... ===
call scripts\Start-Orbit.bat
