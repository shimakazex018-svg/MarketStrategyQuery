param([int]$DelaySeconds = 20, [string]$UserName)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "market-runtime-common.ps1")
$taskName = "MarketCycleStrategy-Autostart"
$paths = Get-MarketRuntimePaths
$hostScript = Join-Path $PSScriptRoot "run-market-host.ps1"
if (-not (Test-Path -LiteralPath $hostScript -PathType Leaf)) { throw "Host script is missing." }
$powershellExe = Join-Path $PSHOME "powershell.exe"
if (-not $UserName) {
  $activeConsole = query user 2>$null | Where-Object { $_ -match '^\s*>?\s*(\S+)\s+console\s+\d+\s+Active\b' } | Select-Object -First 1
  if ($activeConsole -match '^\s*>?\s*(\S+)\s+console\s+\d+\s+Active\b') { $UserName = "$env:COMPUTERNAME\$($Matches[1])" }
  else { $UserName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name }
}
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$hostScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserName
$trigger.Delay = "PT$DelaySeconds`S"
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $arguments -WorkingDirectory $paths.ProjectRoot
$principal = New-ScheduledTaskPrincipal -UserId $UserName -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$settings.Hidden = $true
$definition = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $taskName -InputObject $definition -Force | Out-Null
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$taskAction = @($task.Actions)[0]
if ($taskAction.Execute -ne $powershellExe -or $taskAction.Arguments -ne $arguments -or $task.Settings.MultipleInstances -ne "IgnoreNew") { throw "Task verification failed." }
[pscustomobject]@{ TaskName = $task.TaskName; Trigger = "AtLogOn"; Delay = $trigger.Delay; Action = "Hidden PowerShell host"; MultipleInstances = $task.Settings.MultipleInstances; RestartCount = $task.Settings.RestartCount; RestartInterval = $task.Settings.RestartInterval }
