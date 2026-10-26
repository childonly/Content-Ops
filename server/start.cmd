@echo off
cd /d "e:\000 【AI-项目】\Trae_work\content-ops-hub\server"
echo [%date% %time%] Starting Content Ops Hub server...
call npx ts-node-dev --transpile-only src/index.ts
echo [%date% %time%] Server exited with code %ERRORLEVEL%
