@echo off
REM ═══════════════════════════════════════════════════════════════════════
REM  Double-click to start the local test server, then open the printed
REM  http://192.168.x.x:8080/ address on your phone (same Wi-Fi).
REM
REM  Prefers Node (serve.js prints the LAN address for you). Falls back to
REM  Python, which serves fine but leaves you to find the IP with ipconfig.
REM ═══════════════════════════════════════════════════════════════════════
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  node serve.js 8080
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Node not found - using Python.
  echo Run "ipconfig" in another window to find your IPv4 address,
  echo then open http://THAT-ADDRESS:8080/ on your phone.
  echo.
  python -m http.server 8080
  goto :end
)

echo.
echo  Neither Node nor Python was found on this PC.
echo  Install Node from https://nodejs.org and run this again.
echo.
pause

:end
