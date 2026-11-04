@echo off
chcp 65001 >nul
title Orbit - kontrol
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Check-Orbit.ps1"
echo.
pause
