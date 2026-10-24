@echo off
chcp 65001 >nul
rem ============================================================
rem  Orbit – Start
rem  Starter companion-serveren (port 4310) og dev-serveren
rem  (port 5173), hvis de ikke allerede kører, og åbner Orbit
rem  i standardbrowseren på http://localhost:5173
rem ============================================================
cd /d "%~dp0.."

rem Bemærk: kun "LISTENING" tæller - TIME_WAIT-rester fra en lige
rem lukket server må ikke forhindre opstart.
netstat -ano | findstr /R ":5173 .*LISTENING" >nul
if errorlevel 1 (
  echo Starter Orbit dev-server ^(port 5173^)...
  start "" /min cmd /c "npm run dev:app"
) else (
  echo Dev-serveren kører allerede ^(port 5173^).
)

netstat -ano | findstr /R ":4310 .*LISTENING" >nul
if errorlevel 1 (
  echo Starter Orbit companion-server ^(port 4310^)...
  start "" /min cmd /c "node server\companion.mjs"
) else (
  echo Companion-serveren kører allerede ^(port 4310^).
)

timeout /t 2 /nobreak >nul
echo Åbner Orbit i browseren: http://localhost:5173
start "" http://localhost:5173
