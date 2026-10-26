@echo off
chcp 65001 >nul
title Content Ops Hub - 停止服务
color 0E

echo ============================================================
echo   Content Ops Hub - 停止所有服务
echo ============================================================
echo.

echo [1/2] 停止后端服务 (端口 3100)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3100.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    echo   已终止 PID: %%a
)

echo [2/2] 停止前端服务 (端口 5180)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5180.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    echo   已终止 PID: %%a
)

echo.
echo ============================================================
echo   所有服务已停止
echo ============================================================
echo.
pause
