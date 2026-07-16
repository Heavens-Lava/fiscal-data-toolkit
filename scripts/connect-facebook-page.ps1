param(
  [string]$PageName = "America by the Numbers",
  [switch]$FromClipboard
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$connector = Join-Path $PSScriptRoot "facebook-connect.mjs"
$pointer = [IntPtr]::Zero

if ($FromClipboard) {
  $clipboardText = Get-Clipboard -Raw
  $token = $clipboardText.Trim().Trim('"').Trim("'") -replace '\s', ''
  # Windows PowerShell rejects an empty clipboard value, so overwrite it with whitespace.
  Set-Clipboard -Value " "
  if (-not $token) { throw "The clipboard did not contain a token." }
  if ($token.Length -lt 40) {
    throw "The clipboard value is too short to be a Meta User Access Token. Copy the token and immediately rerun this command."
  }
  Write-Host "Token read ($($token.Length) characters). The clipboard has been cleared."
} else {
  Write-Host "Nothing will appear while you paste. Paste, then press Enter."
  $secure = Read-Host "Paste a fresh Meta User Access Token" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
}

try {
  $env:FB_USER_ACCESS_TOKEN = $token

  Write-Host "Pages available to this token:"
  node $connector list
  if ($LASTEXITCODE -ne 0) { throw "Meta did not return the Page list." }

  node $connector connect --page $PageName
  if ($LASTEXITCODE -ne 0) { throw "The Page could not be connected." }

  Remove-Item Env:FB_USER_ACCESS_TOKEN -ErrorAction SilentlyContinue
  node $connector verify
  if ($LASTEXITCODE -ne 0) { throw "The saved Page credentials could not be verified." }

  Write-Host "Facebook Page credentials are saved in the gitignored .env file."
} finally {
  Remove-Item Env:FB_USER_ACCESS_TOKEN -ErrorAction SilentlyContinue
  $token = $null
  $clipboardText = $null
  if ($pointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}
