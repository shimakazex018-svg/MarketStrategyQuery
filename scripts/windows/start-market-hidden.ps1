param([int]$TimeoutSeconds = 30)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "market-runtime-common.ps1")
$statusScript = Join-Path $PSScriptRoot "status-market.ps1"
$status = & $statusScript
if ($status.Status -eq "running") { $status; exit 0 }
if ($status.Listening) { throw "Port 48101 is already occupied by an unverified process." }
$task = Get-ScheduledTask -TaskName "MarketCycleStrategy-Autostart" -ErrorAction SilentlyContinue
if (-not $task) { throw "Autostart task is not installed. Run register-market-autostart.ps1 first." }
if ($task.State -ne "Running") { Start-ScheduledTask -TaskName "MarketCycleStrategy-Autostart" }
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do { Start-Sleep -Milliseconds 500; $status = & $statusScript; if ($status.Status -eq "running") { $status; exit 0 } } while ((Get-Date) -lt $deadline)
throw "Market service did not become healthy within $TimeoutSeconds seconds."
