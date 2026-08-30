@echo off
setlocal
cd /d "%~dp0"
if not exist "dist-control\gam.cjs" (
  echo GAM runtime is not built. Building control plane...
  call npm run build:control
  if errorlevel 1 exit /b %errorlevel%
)
node "dist-control\gam.cjs" %*
exit /b %errorlevel%
