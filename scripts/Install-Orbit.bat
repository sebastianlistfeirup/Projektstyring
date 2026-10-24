@echo off
chcp 65001 >nul
rem ============================================================
rem  Orbit – én-klik installér/opdatér og start
rem  Henter nyeste version (AI-værksted-branchen), installerer
rem  afhængigheder hvis nødvendigt og starter app + companion.
rem  Dobbeltklik på denne fil. Kræver git og Node.js 20+.
rem ============================================================
cd /d "%~dp0.."
title Orbit – installerer og starter...

echo.
echo === Henter nyeste version fra GitHub... ===
git fetch origin
if errorlevel 1 (
  echo FEJL: git kunne ikke hente noget. Tjek internetforbindelsen.
  pause
  exit /b 1
)
git checkout feature/mine-opgaver-aarshjul-ai-vaerksted
git pull origin feature/mine-opgaver-aarshjul-ai-vaerksted

echo.
echo === Installerer afhængigheder... ===
if not exist node_modules (
  echo node_modules mangler - kører npm install ^(tager typisk 1-3 minutter^)...
  call npm install
  if errorlevel 1 (
    echo FEJL: npm install slog fejl. Er Node.js 20+ installeret?
    pause
    exit /b 1
  )
) else (
  echo node_modules findes allerede - springer over.
)

echo.
echo === Starter Orbit... ===
call scripts\Start-Orbit.bat
