@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Test-Path -LiteralPath '%~dp0Instalar-fh-ia.ps1') { & '%~dp0Instalar-fh-ia.ps1' } else { irm https://raw.githubusercontent.com/Gabriel-Francisco-Bits/fh-ia/main/Instalar-fh-ia.ps1 | iex }"
if errorlevel 1 exit /b 1
echo.
pause
