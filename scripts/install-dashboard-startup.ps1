param([string]$TaskName = "Fiscal Data Toolkit - Approval Dashboard")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "server.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([timespan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Runs the password-protected Facebook approval dashboard on 127.0.0.1:3000." -Force | Out-Null
Write-Host "Installed dashboard startup task: $TaskName"
Write-Host "Start it now with: Start-ScheduledTask -TaskName '$TaskName'"
