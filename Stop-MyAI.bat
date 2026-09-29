@echo off
title Stop MyAI-Agent + FreeLLMAPI
echo Stopping MyAI-Agent (port 3000) and FreeLLMAPI gateway (port 3001)...

for %%P in (3000 3001) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr /C:":%%P " ^| findstr /C:"LISTENING"') do (
        echo   killing PID %%A (port %%P^)
        taskkill /PID %%A /F >nul 2>&1
    )
)

echo Done.
timeout /t 2 >nul
