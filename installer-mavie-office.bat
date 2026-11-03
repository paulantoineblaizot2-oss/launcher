@echo off
setlocal
title Mise a jour du site MAVIE
echo Mise a jour du site, Suite Horizon et Havre.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable sur ce PC. Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)
node "%~dp0installer-mavie-office.js"
if errorlevel 1 (
  echo.
  echo La mise a jour a echoue. Les fichiers deja remplaces ont ete restaures.
  pause
  exit /b 1
)
echo.
echo Termine. Relance activer-https.bat pour demarrer les deux serveurs Node et actualiser Caddy.
pause
