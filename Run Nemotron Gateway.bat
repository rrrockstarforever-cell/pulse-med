@echo off
rem Starts the Nemotron orchestrator gateway for Claude Desktop (CC Switch provider
rem "Nemotron Orchestrator" -> http://127.0.0.1:8093). Keep this window open.
rem Control Center: http://127.0.0.1:8093/nemotron-dashboard.html
title Nemotron Gateway (port 8093)
cd /d "%~dp0"
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$url='http://127.0.0.1:8093/nemotron-dashboard.html'; for($i=0; $i -lt 120; $i++){try{if((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){Start-Process $url; exit}}catch{}; Start-Sleep -Seconds 1}"
:loop
call npm run nemotron:gateway
echo.
echo Gateway stopped. Restarting in 3 seconds (close this window to stop it)...
timeout /t 3 /nobreak >nul
goto loop
