@echo off
chcp 65001 >nul
title Orbit - opdater og start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Orbit-Preview.ps1"
if errorlevel 1 (
  echo.
  echo Opdateringen blev ikke gennemfoert. Se forklaringen ovenfor.
  pause
  exit /b 1
)
