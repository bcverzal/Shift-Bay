@echo off
REM Legacy name retained for existing shortcuts. The PowerShell launcher verifies
REM that the server is local-json before it opens a browser.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch Shift Bay Local.ps1"
