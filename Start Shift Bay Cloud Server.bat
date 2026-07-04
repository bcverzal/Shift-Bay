@echo off
cd /d "%~dp0"
set PORT=8798
echo Starting Shift Bay cloud server...
echo.
echo Keep this window open while using Shift Bay on this computer.
echo Open http://localhost:%PORT%/ in Chrome if it does not open automatically.
echo.
start "" "http://localhost:%PORT%/"
node server.js
pause
