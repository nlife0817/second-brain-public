# Second Brain — autostart script
# Запускает next dev на порту 3000, если не запущен

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$port = 3000
$logFile = Join-Path $projectDir "data\autostart.log"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Out-File -Append -FilePath $logFile -Encoding utf8
}

# Ensure data dir exists
$dataDir = Join-Path $projectDir "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

Write-Log "Autostart triggered"

# Check if port 3000 is already in use
$portInUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Log "Port $port already in use — skipping start"
    exit 0
}

# Check if next dev process is already running
$existing = Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object {
        try {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
            $cmd -and $cmd -match "next\s+dev"
        } catch { $false }
    }

if ($existing) {
    Write-Log "next dev already running (PID: $($existing.Id)) — skipping start"
    exit 0
}

Write-Log "Starting next dev in $projectDir"

# Start next dev in hidden window
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c cd /d `"$projectDir`" && npm run dev"
$psi.WorkingDirectory = $projectDir
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.CreateNoWindow = $true
$psi.UseShellExecute = $false

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Log "Started next dev (PID: $($proc.Id))"
