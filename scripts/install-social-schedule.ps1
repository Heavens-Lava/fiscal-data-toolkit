param(
  [string[]]$Days = @("Monday", "Wednesday", "Friday"),
  [string]$At = "08:00",
  [string]$TaskName = "Fiscal Data Toolkit - Stage Facebook Post"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$time = [datetime]::ParseExact($At, "HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\autonomous-social-run.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $Days -At $time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Generate one data post and stage it for password-protected web approval. Never publishes automatically." -Force | Out-Null
Write-Host "Installed scheduled task: $TaskName"
Write-Host "Schedule: $($Days -join ', ') at $At"
Write-Host "The task stages posts only. Publishing still requires the dashboard button."
