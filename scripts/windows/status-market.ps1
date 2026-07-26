param([int]$Port = 48101)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "market-runtime-common.ps1")
$paths = Get-MarketRuntimePaths
$metadata = Read-MarketPidMetadata
$listener = Get-MarketPortListener -Port $Port
$listenerPid = if ($listener.Pids.Count -eq 1) { [int]$listener.Pids[0] } else { $null }
$metadataMatches = $metadata -and $metadata.ProcessId -and (Test-MarketProcess -ProcessId ([int]$metadata.ProcessId) -ExpectedNodePath $metadata.NodePath)
$listenerMatches = $metadataMatches -and $listenerPid -eq [int]$metadata.ProcessId
$task = Get-ScheduledTask -TaskName "MarketCycleStrategy-Autostart" -ErrorAction SilentlyContinue
$healthy = $listenerMatches -and (Test-MarketHealth -Port $Port)
[pscustomobject]@{ Status = if ($healthy) { "running" } elseif ($listener.Listening -or $metadataMatches) { "degraded" } else { "stopped" }; PID = if ($metadataMatches) { [int]$metadata.ProcessId } else { $null }; Port = $Port; Listening = $listener.Listening; ListenerPID = $listenerPid; ListenerMatchesProject = [bool]$listenerMatches; HealthReady = (Test-MarketHealth -Port $Port); ScheduledTask = if ($task) { [string]$task.State } else { "Missing" }; StartupLog = "runtime-data/logs/market-cycle/startup.log"; StdoutLog = "runtime-data/logs/market-cycle/server-out.log"; StderrLog = "runtime-data/logs/market-cycle/server-error.log" }
