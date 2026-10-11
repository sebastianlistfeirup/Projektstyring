@echo off
chcp 65001 >nul
rem ============================================================
rem  Orbit – Fjern autostart
rem  Sletter genvejen til Start-Orbit.bat fra brugerens
rem  opstartsmappe.
rem ============================================================
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Orbit.lnk"

if exist "%LNK%" (
  del "%LNK%"
  echo Genvej fjernet: %LNK%
) else (
  echo Der var ingen Orbit-genvej i opstartsmappe.
)
