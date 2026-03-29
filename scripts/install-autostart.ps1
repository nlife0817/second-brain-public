# Install Second Brain autostart via Task Scheduler
# Run as: powershell -ExecutionPolicy Bypass -File install-autostart.ps1

$taskName = "SecondBrain-Autostart"
$scriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "autostart.ps1"
$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task '$taskName'"
}

# Create the task
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`"" `
    -WorkingDirectory $projectDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Auto-start Second Brain (next dev) on logon" | Out-Null

Write-Host ""
Write-Host "Task '$taskName' installed successfully." -ForegroundColor Green
Write-Host "Second Brain will auto-start on login at http://localhost:3000"
Write-Host ""
Write-Host "To test now:  schtasks /run /tn '$taskName'"
Write-Host "To remove:    powershell -File scripts\uninstall-autostart.ps1"
