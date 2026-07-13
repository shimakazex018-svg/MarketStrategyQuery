$ErrorActionPreference = "Stop"
$env:HOST = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$env:PORT = if ($env:PORT) { $env:PORT } else { "48101" }
Set-Location (Split-Path -Parent $PSScriptRoot)
node .\server.js
