@echo off
setlocal
cd /d "%~dp0\..\.."

echo Accord Windows x64 build
echo ------------------------

if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build:win
) else (
  npm run build:win
)

if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

node scripts\prune-dist.js

echo.
echo Done:
echo dist\Accord Windows x64 Portable.exe
echo.
pause
