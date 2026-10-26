@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
rem ============================================================
rem  Orbit – Start (ALTID-virker-version)
rem  1) Selv-lokation: virker uanset hvorfra genvejen kalder den
rem  2) Tjekker IKKE bare porte – den tjekker om serverne faktisk
rem     SVARER på HTTP. Hænger en gammel proces, dræbes den og
rem     serveren genstartes.
rem  3) Åbner først browseren, når appen rent faktisk svarer.
rem ============================================================
cd /d "%~dp0.."

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

rem ---- Server 1: dev-server (port 5173) ----
call :ensure_server 5173 "npm run dev:app" "Orbit dev-server"

rem ---- Server 2: companion (port 4310) ----
call :ensure_server 4310 "node server\companion.mjs" "Orbit companion-server"

rem ---- Vent på at appen svarer (max 30 sek), åbn så browseren ----
echo.
set /a waited=0
:wait_app
curl -s -o nul http://localhost:5173
if not errorlevel 1 goto app_ready
set /a waited+=1
if !waited! geq 30 goto app_slow
timeout /t 1 /nobreak >nul
goto wait_app

:app_slow
echo  [ADVARSEL] Dev-serveren svarede ikke efter 30 sekunder.
echo  Den starter måske langsomt første gang (npm install?). Browseren åbnes alligevel...
:app_ready
echo.
echo  Orbit: http://localhost:5173
start "" http://localhost:5173
echo.
echo  Tips:
echo   - Serverne kører i to små baggrundsvinduer (minimerede).
echo   - Vil du lukke Orbit helt: luk de to vinduer, eller kør scripts\Stop-Orbit.bat
echo.
timeout /t 4 >nul
exit /b 0


rem ============================================================
rem  :ensure_server  PORT  "KOMMANDO"  "NAVN"
rem  Genbrugelig rutine: lever kun hvis porten SVARER på HTTP.
rem  Hænger processen (port optaget, intet svar), dræbes den.
rem ============================================================
:ensure_server
set PORT=%1
set SRV_CMD=%~2
set SRV_NAME=%~3

rem 1) Svarer serveren allerede? Så er alt fint.
curl -s -o nul http://localhost:%PORT%
if not errorlevel 1 (
  echo  [OK] %SRV_NAME% kører allerede (port %PORT% svarer).
  goto :eof
)

rem 2) Optager en gammel/hængt proces porten uden at svare? Dræb den.
netstat -ano | findstr /R ":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo  [FIX] %SRV_NAME% hænger (port %PORT% optaget, intet svar) - genstarter...
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R ":%PORT% .*LISTENING"') do (
    taskkill /PID %%P /F >nul 2>nul
  )
  timeout /t 2 /nobreak >nul
)

rem 3) Start serveren i et minimeret vindue med titel, så den er nem at finde.
echo  [START] %SRV_NAME% (port %PORT%)...
start "%SRV_NAME%" /min cmd /k "%SRV_CMD%"
goto :eof
