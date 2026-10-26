# Content Ops Hub startup script
$workDir = 'e:\000 【AI-项目】\Trae_work\content-ops-hub'
Set-Location $workDir
$logFile = "$env:USERPROFILE\.pm2\startup.log"
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting..." | Add-Content $logFile -Encoding utf8
npx pm2 resurrect 2>&1 | Add-Content $logFile -Encoding utf8
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Done" | Add-Content $logFile -Encoding utf8
