# Uninstall Second Brain autostart task

$taskName = "SecondBrain-Autostart"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Task '$taskName' not found — nothing to remove."
    exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Task '$taskName' removed." -ForegroundColor Green
