@echo off
title MyAI-Agent + FreeLLMAPI

echo ============================================
echo   MyAI-Agent launcher
echo ============================================

netstat -ano | findstr /C:":3001 " | findstr /C:"LISTENING" >nul
if errorlevel 1 goto startgw
echo   FreeLLMAPI gateway: ALREADY RUNNING on port 3001
goto agent

:startgw
echo   Starting FreeLLMAPI gateway on port 3001...
cd /d "%~dp0freellmapi"
start "FreeLLMAPI gateway" cmd /k "set PORT=3001&& node server\dist\index.js"

:agent
netstat -ano | findstr /C:":3000 " | findstr /C:"LISTENING" >nul
if errorlevel 1 goto startagent
echo   MyAI-Agent: ALREADY RUNNING on port 3000
goto done

:startagent
echo   Starting MyAI-Agent on port 3000...
cd /d "%~dp0"
start "MyAI-Agent" cmd /k "node server.js"

:done
timeout /t 6 >nul
echo.
echo   Gateway dashboard:  http://localhost:3001   (login: shrey@local.dev / Shrey@3001)
echo   Agent API:          http://localhost:3000
echo.
echo   Close the two black server windows to stop everything.
echo.
pause
