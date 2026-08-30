@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-runtime-windows.ps1" -CreateDesktopShortcut %*
exit /b %ERRORLEVEL%
