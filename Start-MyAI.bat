@echo off
title MyAI-Agent + FreeLLMAPI
echo ============================================
echo   Starting FreeLLMAPI gateway (port 3001)...
echo ============================================
cd /d "%~dp0freellmapi"
start "FreeLLMAPI gateway" cmd /k "set PORT=3001 && node server\dist\index.js"

echo ============================================
echo   Starting MyAI-Agent server (port 3000)...
echo ============================================
cd /d "%~dp0"
start "MyAI-Agent" cmd /k "node server.js"

timeout /t 5 >nul
echo.
echo   Gateway dashboard:  http://localhost:3001
echo   Agent API:          http://localhost:3000
echo   Test it:            POST http://localhost:3000/api/agent  {"message":"your task"}
echo.
pause
