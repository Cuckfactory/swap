@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   CUCK BAG RECYCLER V5 - LOCAL TEST
 echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this PC.
  echo.
  echo Install the LTS version from https://nodejs.org/
  echo Then double-click START_WINDOWS.bat again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing the LI.FI widget and app packages...
  echo This can take a few minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo Starting local test site...
start "CUCK Recycler Dev Server" cmd /k "cd /d \"%~dp0\" && npm run dev -- --host 127.0.0.1"
timeout /t 4 /nobreak >nul
start "" http://127.0.0.1:5173/

echo.
echo Browser opened at http://127.0.0.1:5173/
echo Keep the other command window open while testing.
echo.
pause
