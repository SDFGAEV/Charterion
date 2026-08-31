@echo off
setlocal
cd /d "%~dp0"
if not exist "dist-control\gamctl.cjs" (
  echo GAM control runtime is not built. Building control plane...
  call npm run build:control
  if errorlevel 1 exit /b %errorlevel%
)
node "dist-control\gamctl.cjs" %*
exit /b %errorlevel%
