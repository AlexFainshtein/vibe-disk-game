@echo off
cd /d "%~dp0"
start "Vibe Disk Server" /min python -m http.server 8000
start "" http://localhost:8000
