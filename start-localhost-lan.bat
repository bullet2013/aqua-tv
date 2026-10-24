@echo off
cd /d "%~dp0"
echo AQUA TV для локальной сети: http://IP-ADRES-KOMPYUTERA:8000
node server.mjs --lan
pause
