@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Требуется Node.js 20+ для общего автообновления EPG на localhost.
  echo https://nodejs.org/
  pause
  exit /b 1
)
echo AQUA TV: http://localhost:8000
node server.mjs
pause
