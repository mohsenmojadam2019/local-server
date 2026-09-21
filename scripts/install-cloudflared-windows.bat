@echo off
where winget >nul 2>nul
if errorlevel 1 (
  echo winget is not available. Install cloudflared manually from Cloudflare documentation.
  pause
  exit /b 1
)
winget install --id Cloudflare.cloudflared -e
pause
