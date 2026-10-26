@echo off
chcp 65001 >nul
title Content Ops Hub - Backend (Node 22 / port 3100)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-services.ps1" -BackendOnly
if errorlevel 1 (
  echo.
  echo 后端启动失败，请检查 logs 目录。
  pause
  exit /b 1
)

echo.
echo 后端已启动：http://127.0.0.1:3100
pause
