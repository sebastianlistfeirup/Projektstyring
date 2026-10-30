@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================
rem  Orbit – Start
rem  Genbruger sunde servere, saa aktive AI-koersler fortsaetter.
rem  Browseren aabnes foerst naar
rem  bade appen og companion-serveren faktisk svarer paa HTTP.
rem ============================================================
cd /d "%~dp0.."
echo  Orbit starter - et oejeblik ...

rem ---- Selvhelende genvej: kører i baggrunden og blokerer ikke opstarten ----
start "Orbit-genvej" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Ensure-Shortcut.ps1" -BatPath "%~f0" >nul 2>nul

rem ---- Sanity: findes node? ----
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [FEJL] Node.js blev ikke fundet i PATH.
  echo  Installér Node.js fra https://nodejs.org og prøv igen.
  echo.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
  echo [FEJL] Orbit kraever Node.js 22.13+; installer gerne Node.js 24 LTS.
  pause
  exit /b 1
)

rem Ét automatisk nyt forsøg beskytter mod en proces, der dør under opstarten.
set /a START_ATTEMPT=0
:start_servers
set /a START_ATTEMPT+=1
if !START_ATTEMPT! gtr 1 echo  [FIX] Serverne svarede ikke stabilt - proever igen...

rem Aabning af appen maa aldrig draebe en igangvaerende AI-koersel.
call :ensure_server 5173 "npm run dev:app" "Orbit dev-server" "/@vite/client"
if errorlevel 1 goto start_failed
call :ensure_server 4310 "node server\companion.mjs" "Orbit companion-server" "/api/ping"
if errorlevel 1 goto start_failed

rem ---- Vent på begge servere (max 45 sek. pr. forsøg) ----
echo.
echo  [VENT] Kontrollerer at Orbit er klar...
set /a WAITED=0
:wait_ready
curl -s -o nul --connect-timeout 1 --max-time 2 http://127.0.0.1:5173/
if errorlevel 1 goto wait_more
curl -f -s -o nul --connect-timeout 1 --max-time 2 http://127.0.0.1:4310/api/ping
if not errorlevel 1 goto orbit_ready
:wait_more
set /a WAITED+=1
if !WAITED! geq 45 goto start_failed
powershell -NoProfile -NonInteractive -Command "Start-Sleep -Seconds 1" >nul 2>nul
goto wait_ready

:start_failed
if !START_ATTEMPT! lss 2 goto start_servers
echo.
echo  [FEJL] Orbit kunne ikke starte stabilt efter to forsøg.
echo  Se fejlmeddelelsen i de to minimerede servervinduer.
echo  Genvejen åbner ikke en side, som ikke svarer.
echo.
pause
exit /b 1

:orbit_ready
echo.
echo  [OK] Appen og companion-serveren svarer.
echo  Orbit: http://localhost:5173
start "" "http://localhost:5173/"
echo.
echo  Tips:
echo   - Serverne kører i to små baggrundsvinduer (minimerede).
echo   - Vil du lukke Orbit helt: luk de to vinduer, eller kør scripts\Stop-Orbit.bat
echo.
timeout /t 4 /nobreak >nul 2>nul
exit /b 0


rem ============================================================
rem  Genbrug en sund server. Stop aldrig en ukendt eller aktiv proces.
rem ============================================================
:ensure_server
set "ORBIT_SERVER_PORT=%~1"
set "ORBIT_SERVER_CMD=%~2"
set "ORBIT_SERVER_NAME=%~3"
curl -f -s -o nul --connect-timeout 1 --max-time 2 "http://127.0.0.1:%ORBIT_SERVER_PORT%%~4"
if not errorlevel 1 (
  echo  [OK] %ORBIT_SERVER_NAME% koerer allerede og genbruges.
  exit /b 0
)
netstat -ano | findstr /R /C:":%ORBIT_SERVER_PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo  [FEJL] Port %ORBIT_SERVER_PORT% er optaget, men serveren svarer ikke korrekt.
  echo  Kontrollér servervinduet. Ingen proces er blevet stoppet.
  exit /b 1
)
echo  [START] %ORBIT_SERVER_NAME% ^(port %ORBIT_SERVER_PORT%^) ...
start "%ORBIT_SERVER_NAME%" /min cmd /d /k "%ORBIT_SERVER_CMD%"
exit /b 0
