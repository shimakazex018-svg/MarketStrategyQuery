param([string]$NodePath, [int]$Port = 48101, [int]$HealthTimeoutSeconds = 30)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "market-runtime-common.ps1")
$paths = Initialize-MarketRuntimeDirectories
$serverPath = Join-Path $paths.ProjectRoot "server.js"
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) { throw "server.js is missing." }
$node = Resolve-MarketNode -NodePath $NodePath

$listener = Get-MarketPortListener -Port $Port
if ($listener.Listening) {
  if ($listener.Pids.Count -eq 1 -and (Test-MarketProcess -ProcessId ([int]$listener.Pids[0]))) {
    Write-MarketStartupLog -Event "already_running" -Details @{ pid = [int]$listener.Pids[0]; port = $Port }
    exit 0
  }
  Write-MarketStartupLog -Event "port_occupied" -Details @{ port = $Port; listenerCount = $listener.Pids.Count }
  throw "Port $Port is occupied by an unverified process."
}
Remove-StaleMarketPidFile | Out-Null
Rotate-MarketLog -Path $paths.StdoutLog
Rotate-MarketLog -Path $paths.StderrLog
$env:HOST = "0.0.0.0"
$env:PORT = [string]$Port
Write-MarketStartupLog -Event "starting" -Details @{ port = $Port }
$process = Start-Process -FilePath $node -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $paths.ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $paths.StdoutLog -RedirectStandardError $paths.StderrLog -PassThru
$metadata = [ordered]@{ ProcessId = $process.Id; NodePath = [System.IO.Path]::GetFullPath($node); ServerPath = [System.IO.Path]::GetFullPath($serverPath); StartTimeUtc = $process.StartTime.ToUniversalTime().ToString("o"); HostProcessId = $PID; Port = $Port; TaskName = "MarketCycleStrategy-Autostart" }
$metadata | ConvertTo-Json | Set-Content -LiteralPath $paths.PidFile -Encoding UTF8

$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
do {
  if (Test-MarketHealth -Port $Port) { break }
  if ($process.HasExited) { throw "Market service exited before health became ready." }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if (-not (Test-MarketHealth -Port $Port)) { throw "Market service health check timed out." }
Write-MarketStartupLog -Event "ready" -Details @{ pid = $process.Id; port = $Port }

$exitCode = $null
try { $process.WaitForExit(); $exitCode = $process.ExitCode } finally {
  @{ ProcessId = $process.Id; ExitedAt = (Get-Date).ToUniversalTime().ToString("o"); ExitCode = $exitCode } | ConvertTo-Json | Set-Content -LiteralPath $paths.ExitRecord -Encoding UTF8
  $stored = Read-MarketPidMetadata
  if ($stored -and [int]$stored.ProcessId -eq $process.Id) { Remove-Item -LiteralPath $paths.PidFile -Force -ErrorAction SilentlyContinue }
  Write-MarketStartupLog -Event "exited" -Details @{ pid = $process.Id; exitCode = $exitCode }
}
if ($null -eq $exitCode) { exit 1 }
exit $exitCode
