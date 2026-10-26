@echo off
chcp 65001 >nul
rem ============================================================
rem  Orbit – Stop
rem  Dræber processerne, der lytter på port 5173 og 4310.
rem ============================================================
echo Lukker Orbit (port 5173 og 4310)...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R ":5173 .*LISTENING"') do (
  echo  - Dræber dev-server (PID %%P)
  taskkill /PID %%P /F >nul 2>nul
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R ":4310 .*LISTENING"') do (
  echo  - Dræber companion-server (PID %%P)
  taskkill /PID %%P /F >nul 2>nul
)

echo.
echo Orbit er lukket.
timeout /t 3 >nul
