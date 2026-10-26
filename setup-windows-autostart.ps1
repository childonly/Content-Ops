# ============================================================
# Windows Auto-Start Setup for PM2
#
# Creates a Windows Task Scheduler task to auto-restore PM2
# processes on user login or system boot.
#
# Usage (run as Administrator):
#   powershell -ExecutionPolicy Bypass -File setup-windows-autostart.ps1
# ============================================================

$taskName = "PM2AutoStart"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if task already exists
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "[INFO] Task '$taskName' already exists, removing old task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Build startup script content
$startupScript = Join-Path $projectDir "pm2-autostart.ps1"
$scriptContent = @"
# Wait for network services to be ready
Start-Sleep -Seconds 15

# Set up PATH
`$env:PATH = `$env:PATH + ';$env:APPDATA\npm'

# Restore PM2 processes
cd '$projectDir'
npx pm2 resurrect
Write-Host '[PM2 AutoStart] PM2 processes restored.'
"@

Set-Content -Path $startupScript -Value $scriptContent -Encoding ASCII

# Create scheduled task action
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startupScript`""

# Trigger 1: On user logon
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn

# Trigger 2: On system startup (30 second delay for network readiness)
$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$triggerBoot.Delay = "PT30S"

# Task settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

# Principal (run as current user, interactive session)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

# Register the task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($triggerLogon, $triggerBoot) -Settings $settings -Principal $principal -Description "Auto-restore PM2 managed content-ops-hub services" -Force

Write-Host ""
Write-Host "[SUCCESS] Windows auto-start task created!" -ForegroundColor Green
Write-Host "  Task name: $taskName" -ForegroundColor Cyan
Write-Host "  Triggers:  User logon OR system boot (30s delay)" -ForegroundColor Cyan
Write-Host "  Script:    $startupScript" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. npx pm2 save              (save current process list)" -ForegroundColor White
Write-Host "  2. Reboot computer - PM2 will auto-restore services" -ForegroundColor White
Write-Host ""
Write-Host "Management commands:" -ForegroundColor Yellow
Write-Host "  View task:   Get-ScheduledTask -TaskName $taskName" -ForegroundColor White
Write-Host "  Run manually: Start-ScheduledTask -TaskName $taskName" -ForegroundColor White
Write-Host "  Delete task: Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false" -ForegroundColor White
