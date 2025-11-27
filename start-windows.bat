@echo off
REM Unity Editor Log Analyzer - Windows Launcher
REM Starts a simple HTTP server (required for Web Workers)

echo.
echo ============================================================
echo Unity Editor Log Analyzer
echo ============================================================
echo.
echo Starting local server...
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is required to run the local server.
    echo Please install Python 3 from https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

REM Start the server
python start-server.py

pause
