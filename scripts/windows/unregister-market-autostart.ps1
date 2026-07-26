$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName "MarketCycleStrategy-Autostart" -ErrorAction SilentlyContinue
if ($task) { Unregister-ScheduledTask -TaskName "MarketCycleStrategy-Autostart" -Confirm:$false }
