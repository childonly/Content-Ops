@echo off
chcp 65001 >nul
title Content Ops Hub - 小红书扫码登录
color 0D

echo ============================================================
echo   小红书扫码登录
echo ============================================================
echo.
echo 正在打开浏览器显示二维码...
echo.
echo 请使用小红书 App 扫描屏幕上的二维码
echo 扫码后请在手机上确认登录
echo.
echo (登录成功后 cookie 会自动保存，后续发布无需再次扫码)
echo.

cd /d C:\Users\wml1027\.trae-cn\skills\xiaohongshu-skill
python -m scripts qrcode --headless=false

echo.
echo ============================================================
echo   登录流程已结束
echo   可通过 check-login 命令验证登录状态
echo ============================================================
pause
