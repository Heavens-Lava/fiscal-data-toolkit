$ErrorActionPreference = "Stop"
$secure = Read-Host "Choose the remote approval password (12+ characters)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:APPROVAL_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  node (Join-Path $PSScriptRoot "setup-approval-auth.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Approval setup failed." }
} finally {
  Remove-Item Env:APPROVAL_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
