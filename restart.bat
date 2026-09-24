@echo off
REM Stops whatever is already serving the game on this port, then starts a
REM fresh server in this window. Double-click it, or run "restart" from a
REM terminal in this folder. Ctrl+C (or closing the window) stops the server.
setlocal
cd /d "%~dp0"

set PORT=3000
if not "%~1"=="" set PORT=%~1

echo.
echo  Minecraft PvP - restarting local server on port %PORT%
echo  ---------------------------------------------------

REM Find the process listening on the port and stop it. Only LISTENING rows
REM are matched, so a stale browser connection can't get something killed.
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP .*:%PORT% .*LISTENING"') do (
  if not "%%p"=="0" (
    set FOUND=1
    echo  Stopping old server ^(PID %%p^)...
    taskkill /F /PID %%p >nul 2>&1
  )
)
if not defined FOUND echo  No server was running.

REM Give Windows a moment to actually release the port, or the new server
REM can fail to bind with EADDRINUSE. ping is used rather than timeout,
REM which needs a real console and errors out when there isn't one.
ping -n 3 127.0.0.1 >nul

echo  Starting server...
echo.
set PORT=%PORT%
node server.js

REM Only reached once the server exits, so the window stays open long enough
REM to read a crash message instead of vanishing.
echo.
echo  Server stopped.
pause
