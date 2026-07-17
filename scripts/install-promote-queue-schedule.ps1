param(
  [string]$At = "07:00",
  [string]$TaskName = "Fiscal Data Toolkit - Promote Queued Posts"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$time = [datetime]::ParseExact($At, "HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\promote-queued-posts.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Promotes approval-queue posts into real Facebook scheduled slots as the ~27-day scheduling window frees up. Only schedules already-approved/staged posts; never stages or approves new ones." -Force | Out-Null
Write-Host "Installed scheduled task: $TaskName"
Write-Host "Schedule: daily at $At"
Write-Host "This task only promotes already-staged/approved posts into open Facebook slots -- it does not generate or approve new content."
