@echo off
cd /d "%~dp0"
echo Starting Restaurant Scheduler...
echo.
echo Keep this window open while you are using the scheduler from this computer or another computer.
echo.
start "" "http://localhost:8787"
node server.js
pause
