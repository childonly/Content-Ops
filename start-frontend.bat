@echo off
chcp 65001 >nul
title Content Ops Hub - Frontend (Node 22 / port 5180)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-services.ps1" -FrontendOnly -OpenBrowser
if errorlevel 1 (
  echo.
  echo 前端启动失败，请检查 logs 目录。
  pause
  exit /b 1
)

echo.
echo 前端已启动：http://127.0.0.1:5180/dashboard
pause
