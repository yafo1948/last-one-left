@echo off
cd /d %~dp0
start "Last One Left Server" cmd /k python -m http.server 8765
start http://localhost:8765
