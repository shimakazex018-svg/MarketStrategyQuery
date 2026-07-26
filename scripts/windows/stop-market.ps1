param([int]$Port = 48101)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "market-runtime-common.ps1")
$paths = Get-MarketRuntimePaths
$metadata = Read-MarketPidMetadata
if (-not $metadata -or -not $metadata.ProcessId -or -not (Test-MarketProcess -ProcessId ([int]$metadata.ProcessId) -ExpectedNodePath $metadata.NodePath)) { throw "Refusing to stop: PID metadata does not verify this project process." }
$listener = Get-MarketPortListener -Port $Port
if ($listener.Pids.Count -ne 1 -or [int]$listener.Pids[0] -ne [int]$metadata.ProcessId) { throw "Refusing to stop: port listener does not match recorded project process." }
Stop-Process -Id ([int]$metadata.ProcessId)
Wait-Process -Id ([int]$metadata.ProcessId) -Timeout 10 -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $paths.PidFile -Force -ErrorAction SilentlyContinue
Write-MarketStartupLog -Event "stopped" -Details @{ pid = [int]$metadata.ProcessId; port = $Port }
