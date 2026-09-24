@echo off
REM Triggers a Render deploy of whatever is currently on origin/main, using a
REM Render "Deploy Hook" URL kept in render-deploy-hook.txt next to this file.
REM That file is gitignored - the hook URL is a secret, anyone holding it can
REM redeploy the service, so it must never be committed.
REM
REM One-time setup:
REM   Render dashboard -> the minecraft-pvp service -> Settings -> Deploy Hook
REM   -> copy the URL -> paste it as the only line of render-deploy-hook.txt
setlocal
cd /d "%~dp0"

set HOOKFILE=render-deploy-hook.txt
if not exist "%HOOKFILE%" (
  echo.
  echo  No %HOOKFILE% found.
  echo.
  echo  To set it up once:
  echo    1. Open your Render dashboard and pick the minecraft-pvp service
  echo    2. Settings -^> Deploy Hook -^> copy the URL
  echo    3. Save it as the only line of %HOOKFILE% in this folder
  echo.
  echo  After that, running deploy.bat redeploys Render straight from here.
  echo.
  pause
  exit /b 1
)

set /p HOOK=<"%HOOKFILE%"
if "%HOOK%"=="" (
  echo  %HOOKFILE% is empty - paste your Render deploy hook URL into it.
  pause
  exit /b 1
)

echo.
echo  Pushing local commits first...
git push origin main
echo.
echo  Asking Render to deploy...
curl -fsS -X POST "%HOOK%"
if errorlevel 1 (
  echo.
  echo  Deploy request failed. Check the hook URL in %HOOKFILE%.
) else (
  echo.
  echo  Render has started a deploy. It usually goes live in 1-2 minutes.
)
echo.
pause
