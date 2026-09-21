@echo off
setlocal
cd /d "%~dp0\.."
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20+ is not installed.
  echo Install from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)
call npm start
exit /b %errorlevel%
:fail
echo Installation failed.
pause
exit /b 1
