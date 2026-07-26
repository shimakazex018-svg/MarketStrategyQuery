param([int]$TimeoutSeconds = 30)
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "stop-market.ps1")
& (Join-Path $PSScriptRoot "start-market-hidden.ps1") -TimeoutSeconds $TimeoutSeconds
