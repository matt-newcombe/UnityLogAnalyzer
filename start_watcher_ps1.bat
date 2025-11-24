@echo off
REM Unity Log File Watcher - PowerShell Script Launcher
REM No Python or executables required - uses built-in PowerShell

echo.
echo ============================================================
echo Unity Log File Watcher Service (PowerShell)
echo ============================================================
echo.

REM Check PowerShell version (need 5.1+ for HttpListener)
powershell -Command "if ($PSVersionTable.PSVersion.Major -lt 5) { Write-Host 'ERROR: PowerShell 5.1 or later is required.'; exit 1 }"

REM Check execution policy
powershell -Command "if ((Get-ExecutionPolicy) -eq 'Restricted') { Write-Host 'WARNING: Execution policy is Restricted. You may need to run:' -ForegroundColor Yellow; Write-Host '  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser' -ForegroundColor Yellow; Write-Host '' }"

echo Starting watcher service...
echo.

REM Run the PowerShell script
powershell -ExecutionPolicy Bypass -File "%~dp0editor_log_watcher.ps1"

if errorlevel 1 (
    echo.
    echo ERROR: Failed to start watcher service.
    echo.
    pause
    exit /b 1
)


