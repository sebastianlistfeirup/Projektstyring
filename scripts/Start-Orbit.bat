@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================
rem  Orbit – Start
rem  Starter altid friske servere, saa foraeldede eller doede
rem  processer aldrig genbruges. Browseren aabnes foerst naar
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

rem Ét automatisk nyt forsøg beskytter mod en proces, der dør under opstarten.
set /a START_ATTEMPT=0
:start_servers
set /a START_ATTEMPT+=1
if !START_ATTEMPT! gtr 1 echo  [FIX] Serverne svarede ikke stabilt - proever igen...

rem Begge servere genstartes. Det forhindrer en gammel dev-server i at blive
rem genbrugt og do efter den foerste vellykkede HTTP-kontrol.
call :restart_server 5173 "npm run dev:app" "Orbit dev-server"
call :restart_server 4310 "node server\companion.mjs" "Orbit companion-server"

rem ---- Vent på begge servere (max 45 sek. pr. forsøg) ----
echo.
echo  [VENT] Kontrollerer at Orbit er klar...
set /a WAITED=0
:wait_ready
curl -s -o nul --connect-timeout 1 --max-time 2 http://127.0.0.1:5173/
if errorlevel 1 goto wait_more
curl -s -o nul --connect-timeout 1 --max-time 2 http://127.0.0.1:4310/
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
rem  :restart_server  PORT  "KOMMANDO"  "NAVN"
rem  Stopper processen på porten og starter en frisk server.
rem ============================================================
:restart_server
set "PORT=%~1"
set "SRV_CMD=%~2"
set "SRV_NAME=%~3"
call :stop_port "%PORT%"
echo  [START] %SRV_NAME% (port %PORT%)...
start "%SRV_NAME%" /min cmd /d /k "%SRV_CMD%"
exit /b 0


rem ============================================================
rem  :stop_port  PORT
rem  Dræber hele procestræet og venter kort på, at porten frigives.
rem ============================================================
:stop_port
set "STOP_PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%STOP_PORT% .*LISTENING"') do (
  echo  [FIX] Stopper gammel proces paa port %STOP_PORT%...
  taskkill /PID %%P /T /F >nul 2>nul
)
set /a PORT_WAIT=0
:wait_port_free
netstat -ano | findstr /R /C:":%STOP_PORT% .*LISTENING" >nul
if errorlevel 1 exit /b 0
set /a PORT_WAIT+=1
if !PORT_WAIT! geq 10 (
  echo  [ADVARSEL] Port %STOP_PORT% er stadig optaget. Opstarten fortsaetter alligevel.
  exit /b 0
)
powershell -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 500" >nul 2>nul
goto wait_port_free
