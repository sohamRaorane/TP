@echo off
REM One-click launcher for Windows: installs dependencies on first run, then starts
REM the API server (:4000) and the client (:5173) and opens the browser.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing client dependencies...
  call npm install || goto :err
)
if not exist server\node_modules (
  echo Installing server dependencies...
  call npm --prefix server install || goto :err
)
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:5173"
call npm run dev:all
goto :eof
:err
echo Install failed. See the messages above.
pause
