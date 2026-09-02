@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first time - this may take a minute...
  call npm install
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
npm start
