@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Orbit.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 3 >nul
