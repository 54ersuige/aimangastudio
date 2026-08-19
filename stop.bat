@echo off
REM ============================================================
REM  AIMangaStudio silent shutdown
REM  Double-click to stop both backend and frontend processes.
REM  No visible window. Exits immediately.
REM ============================================================

setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%start.ps1" --stop
exit /b %ERRORLEVEL%