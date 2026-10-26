@echo off
chcp 65001 >nul
title Content Ops Hub - Node 22 Launcher

echo 正在启动 Content Ops Hub...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-services.ps1" -OpenBrowser
if errorlevel 1 (
  echo.
  echo 启动失败，请检查 logs 目录。
  pause
  exit /b 1
)

echo.
echo 启动完成：
echo   后端：http://127.0.0.1:3100
echo   前端：http://127.0.0.1:5180/dashboard
pause
