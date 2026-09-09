@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first time - this may take a minute...
  call npm install
)

echo.
echo   Opening three tabs once the server is up:
echo     Customer site   http://localhost:3000/
echo     Owner dashboard http://localhost:3000/admin.html
echo     Driver Hub      http://localhost:3000/driver.html
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000/ & start http://localhost:3000/admin.html & start http://localhost:3000/driver.html"
npm start
