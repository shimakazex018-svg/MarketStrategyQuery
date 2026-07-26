$ErrorActionPreference = "Stop"

function Get-MarketProjectRoot {
  return (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-MarketRuntimePaths {
  $root = Get-MarketProjectRoot
  $runtimeRoot = Join-Path $root "runtime-data"
  return [pscustomobject]@{
    ProjectRoot = $root
    RuntimeRoot = $runtimeRoot
    ProcessDirectory = Join-Path $runtimeRoot "process"
    LogDirectory = Join-Path $runtimeRoot "logs\market-cycle"
    PidFile = Join-Path $runtimeRoot "process\market-cycle.pid"
    StartupLog = Join-Path $runtimeRoot "logs\market-cycle\startup.log"
    StdoutLog = Join-Path $runtimeRoot "logs\market-cycle\server-out.log"
    StderrLog = Join-Path $runtimeRoot "logs\market-cycle\server-error.log"
    ExitRecord = Join-Path $runtimeRoot "process\market-cycle.last-exit.json"
  }
}

function Initialize-MarketRuntimeDirectories {
  $paths = Get-MarketRuntimePaths
  New-Item -ItemType Directory -Force -Path $paths.ProcessDirectory, $paths.LogDirectory | Out-Null
  return $paths
}

function Write-MarketStartupLog {
  param([Parameter(Mandatory)][string]$Event, [hashtable]$Details = @{})
  $paths = Initialize-MarketRuntimeDirectories
  Rotate-MarketLog -Path $paths.StartupLog
  $record = [ordered]@{ time = (Get-Date).ToUniversalTime().ToString("o"); event = $Event }
  foreach ($key in $Details.Keys) { $record[$key] = $Details[$key] }
  ($record | ConvertTo-Json -Compress -Depth 4) | Add-Content -LiteralPath $paths.StartupLog -Encoding UTF8
}

function Rotate-MarketLog {
  param([Parameter(Mandatory)][string]$Path, [int64]$MaximumBytes = 10MB, [int]$Keep = 5)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  if ((Get-Item -LiteralPath $Path).Length -lt $MaximumBytes) { return }
  for ($index = $Keep - 1; $index -ge 1; $index--) {
    $source = "$Path.$index"
    $destination = "$Path.$($index + 1)"
    if (Test-Path -LiteralPath $source) { Move-Item -LiteralPath $source -Destination $destination -Force }
  }
  Move-Item -LiteralPath $Path -Destination "$Path.1" -Force
}

function Resolve-MarketNode {
  param([string]$NodePath)
  if ($NodePath) { return (Resolve-Path -LiteralPath $NodePath).Path }
  if ($env:NODE_EXE) { return (Resolve-Path -LiteralPath $env:NODE_EXE).Path }
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) { return $command.Source }
  $programFilesNode = Join-Path $env:ProgramFiles "nodejs\node.exe"
  if (Test-Path -LiteralPath $programFilesNode -PathType Leaf) { return $programFilesNode }
  $wingetRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path -LiteralPath $wingetRoot -PathType Container) {
    $candidate = Get-ChildItem -LiteralPath $wingetRoot -Directory -Filter "OpenJS.NodeJS.LTS_*" -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue } |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  throw "Node.js runtime not found. Set NODE_EXE or pass -NodePath."
}

function Get-MarketProcessCommandLine {
  param([int]$ProcessId)
  try { return (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop).CommandLine } catch { return $null }
}

function Get-MarketPortListener {
  param([int]$Port = 48101)
  try {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    $pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    return [pscustomobject]@{ Listening = $pids.Count -gt 0; Pids = $pids; QueryFailed = $false }
  } catch {
    return [pscustomobject]@{ Listening = $false; Pids = @(); QueryFailed = $true }
  }
}

function Test-MarketProcess {
  param([Parameter(Mandatory)][int]$ProcessId, [string]$ExpectedNodePath)
  $paths = Get-MarketRuntimePaths
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  if ($ExpectedNodePath -and [System.IO.Path]::GetFullPath($process.Path) -ne [System.IO.Path]::GetFullPath($ExpectedNodePath)) { return $false }
  $commandLine = Get-MarketProcessCommandLine -ProcessId $ProcessId
  return $commandLine -and $commandLine.IndexOf((Join-Path $paths.ProjectRoot "server.js"), [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Read-MarketPidMetadata {
  $paths = Get-MarketRuntimePaths
  if (-not (Test-Path -LiteralPath $paths.PidFile -PathType Leaf)) { return $null }
  try { return Get-Content -LiteralPath $paths.PidFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Remove-StaleMarketPidFile {
  $paths = Get-MarketRuntimePaths
  $metadata = Read-MarketPidMetadata
  if (-not $metadata -or -not $metadata.ProcessId -or -not (Test-MarketProcess -ProcessId ([int]$metadata.ProcessId) -ExpectedNodePath $metadata.NodePath)) {
    Remove-Item -LiteralPath $paths.PidFile -Force -ErrorAction SilentlyContinue
    return $true
  }
  return $false
}

function Test-MarketHealth {
  param([int]$Port = 48101)
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
    return $response.ok -eq $true
  } catch { return $false }
}
