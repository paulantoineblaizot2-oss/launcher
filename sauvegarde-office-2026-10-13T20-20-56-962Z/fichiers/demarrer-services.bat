@echo off
setlocal
title Serveurs Harbor et site MAVIE
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js est introuvable. Installe Node.js 18 ou plus, puis reessaie.
  pause
  exit /b 1
)

echo Demarrage des services independants...
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 start "Harbor Launcher - API modpacks" /D "%~dp0" "%ComSpec%" /k node serveur.js

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8788 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 start "MAVIE - serveur du site" /D "%~dp0" "%ComSpec%" /k node site-serveur.js

timeout /t 2 /nobreak >nul
echo.
echo Harbor Launcher : API sur le port 8787
echo Site MAVIE       : service local sur le port 8788
echo Caddy reste independant. S'il est deja ouvert, il continue de publier le site en HTTPS.
echo Tu peux fermer cette fenetre; laisse ouvertes les deux fenetres Node.
pause
