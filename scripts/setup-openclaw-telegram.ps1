param(
  [Parameter(Mandatory = $true)][string]$TokenFile,
  [Parameter(Mandatory = $true)][string]$ChatId
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$openclaw = Join-Path $env:APPDATA "npm\openclaw.cmd"
if (!(Test-Path -LiteralPath $openclaw)) { throw "OpenClaw was not found at $openclaw" }
if (!(Test-Path -LiteralPath $TokenFile)) { throw "Telegram token file not found: $TokenFile" }

function Invoke-OpenClaw([string[]]$Arguments) {
  & $openclaw @Arguments
  if ($LASTEXITCODE -ne 0) { throw "OpenClaw command failed: openclaw $($Arguments -join ' ')" }
}

$random = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($random)
$gatewayToken = [Convert]::ToBase64String($random)

Invoke-OpenClaw @("config", "set", "gateway.mode", "local")
Invoke-OpenClaw @("config", "set", "gateway.auth.mode", "token")
Invoke-OpenClaw @("config", "set", "gateway.auth.token", $gatewayToken)
Invoke-OpenClaw @("channels", "add", "--channel", "telegram", "--token-file", (Resolve-Path -LiteralPath $TokenFile).Path)
Invoke-OpenClaw @("config", "set", "channels.telegram.dmPolicy", "disabled")
Invoke-OpenClaw @("config", "set", "channels.telegram.groupPolicy", "disabled")
Invoke-OpenClaw @("gateway", "install", "--token", $gatewayToken)
Invoke-OpenClaw @("gateway", "start")

$envFile = Join-Path $root ".env"
$lines = if (Test-Path -LiteralPath $envFile) { [System.Collections.Generic.List[string]](Get-Content -LiteralPath $envFile) } else { [System.Collections.Generic.List[string]]::new() }
$entry = "TELEGRAM_CHAT_ID=$ChatId"
$index = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].StartsWith("TELEGRAM_CHAT_ID=")) { $index = $i; break } }
if ($index -ge 0) { $lines[$index] = $entry } else { $lines.Add($entry) }
[System.IO.File]::WriteAllLines($envFile, $lines)

Write-Host "OpenClaw Telegram confirmations configured for chat $ChatId."
Write-Host "Inbound Telegram commands are disabled; approvals remain web-only."
