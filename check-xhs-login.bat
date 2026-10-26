@echo off
chcp 65001 >nul
title Content Ops Hub - 检查小红书登录状态
color 0F

echo ============================================================
echo   检查小红书登录状态
echo ============================================================
echo.

cd /d C:\Users\wml1027\.trae-cn\skills\xiaohongshu-skill
python -m scripts check-login --headless=true

echo.
pause
