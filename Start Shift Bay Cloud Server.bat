@echo off
cd /d "%~dp0"
set PORT=8798
set NODE_EXE=%~dp0runtime\node\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
echo Starting Shift Bay cloud server...
echo.
echo Keep this window open while using Shift Bay on this computer.
echo Open http://localhost:%PORT%/ in Chrome if it does not open automatically.
echo.
start "" "http://localhost:%PORT%/"
"%NODE_EXE%" server.js
pause
