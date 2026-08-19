@echo off
REM ============================================================
REM  AIMangaStudio one-click launcher (Windows)
REM
REM  Plain double-click = silent background launch (recommended).
REM  The launcher window appears briefly, then disappears.
REM  Services run in background, browser opens automatically.
REM
REM  Usage:
REM    start.bat (no args)    Silent launch. RECOMMENDED default.
REM    start.bat --visible    Same as silent, but keep launcher window open
REM                            (useful for debugging)
REM    start.bat --status     Check whether ports are listening
REM    start.bat --stop       Stop backend and frontend
REM    start.bat --shortcut   Force re-create the desktop / start-menu shortcuts
REM    start.bat --help       Show all options
REM ============================================================

setlocal
set "SCRIPT_DIR=%~dp0"

REM Plain double-click (no args) -> silent mode for max UX.
if "%1"=="" goto :silent

if /I "%1"=="--visible" goto :visible
if /I "%1"=="-v" goto :visible
if /I "%1"=="--silent" goto :silent
if /I "%1"=="-s" goto :silent

REM Anything else (status / stop / shortcut / help) -> normal console.
:normal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start.ps1" %*
exit /b %ERRORLEVEL%

:silent
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%start.ps1" --silent
exit /b %ERRORLEVEL%

:visible
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start.ps1" --silent
exit /b %ERRORLEVEL%