@echo off
setlocal
cd /d "%~dp0"

where caddy.exe >nul 2>&1
if errorlevel 1 if not exist "%~dp0caddy.exe" (
  echo Caddy est introuvable.
  echo Telecharge la version Windows depuis https://caddyserver.com/download
  echo et place caddy.exe dans ce dossier : %~dp0
  pause
  exit /b 1
)

net session >nul 2>&1
if errorlevel 1 (
  echo Redemarrage en administrateur pour ouvrir les ports du pare-feu...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo Le serveur Harbor tourne deja. Ferme sa fenetre, puis relance ce fichier.
  pause
  exit /b 1
)

if not exist "%~dp0config.json" (
  echo config.json introuvable. Lance d'abord une fois lancer-serveur.bat.
  pause
  exit /b 1
)

copy /y "%~dp0config.json" "%~dp0config.json.avant-https.bak" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~dp0config.json'; $c=Get-Content -Raw $p | ConvertFrom-Json; $c | Add-Member -NotePropertyName trustProxy -NotePropertyValue $true -Force; [IO.File]::WriteAllText($p, (ConvertTo-Json $c -Depth 10), [Text.UTF8Encoding]::new($false))"
if errorlevel 1 (
  echo Impossible de preparer config.json.
  pause
  exit /b 1
)

>"%~dp0Caddyfile-Harbor" echo mavie7620.duckdns.org {
>>"%~dp0Caddyfile-Harbor" echo     reverse_proxy 127.0.0.1:8787
>>"%~dp0Caddyfile-Harbor" echo }

netsh advfirewall firewall delete rule name="Harbor HTTPS HTTP" >nul 2>&1
netsh advfirewall firewall delete rule name="Harbor HTTPS HTTPS" >nul 2>&1
netsh advfirewall firewall add rule name="Harbor HTTPS HTTP" dir=in action=allow protocol=TCP localport=80 >nul
netsh advfirewall firewall add rule name="Harbor HTTPS HTTPS" dir=in action=allow protocol=TCP localport=443 >nul

echo Demarrage du serveur Harbor sur le port 8787...
start "Harbor - serveur du site" /D "%~dp0" "%ComSpec%" /k node serveur.js
timeout /t 2 /nobreak >nul
echo Caddy va demander le certificat HTTPS. Garde cette fenetre ouverte.
echo Adresse du site : https://mavie7620.duckdns.org
if exist "%~dp0caddy.exe" (
  "%~dp0caddy.exe" run --config "%~dp0Caddyfile-Harbor" --adapter caddyfile
) else (
  caddy.exe run --config "%~dp0Caddyfile-Harbor" --adapter caddyfile
)
pause
