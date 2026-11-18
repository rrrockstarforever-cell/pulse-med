@echo off
rem Starts Pulse Med in "phone mode": the app is reachable from your phone on the same Wi-Fi, behind a PIN.
rem The PIN is typed here each time and is never saved to a file.
cd /d "%~dp0"
set /p PULSE_REMOTE_PIN=Choose a PIN for your phone (4 or more characters):
if "%PULSE_REMOTE_PIN%"=="" ( echo No PIN, stopping. & pause & exit /b 1 )
if not exist dist\index.html ( echo Building the app first... & call npx vite build )
set NODE_ENV=production
if "%PORT%"=="" set PORT=3200
echo.
echo Open the "Phone URL" below in Chrome on your phone, type the PIN, then menu - Add to Home screen.
echo.
node node_modules\tsx\dist\cli.mjs server.ts
pause
