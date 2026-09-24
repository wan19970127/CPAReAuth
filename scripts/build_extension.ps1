$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$extension = Join-Path $repo 'extension'
$dist = Join-Path $repo 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

function Invoke-Node([string[]]$Arguments, [string]$FailureMessage) {
  & node @Arguments
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

Invoke-Node @('--check', (Join-Path $extension 'background.js')) 'background.js syntax check failed'
Invoke-Node @('--check', (Join-Path $extension 'content.js')) 'content.js syntax check failed'
Invoke-Node @('--check', (Join-Path $extension 'panel.js')) 'panel.js syntax check failed'
Invoke-Node @('--check', (Join-Path $extension 'options.js')) 'options.js syntax check failed'
Invoke-Node @((Join-Path $repo 'scripts\verify_sidepanel_dom_workflow.mjs')) 'Side panel workflow contract failed'
Invoke-Node @((Join-Path $repo 'scripts\test_management_dom_scan.mjs')) 'Management DOM scan test failed'
Invoke-Node @((Join-Path $repo 'scripts\test_content_otp.mjs')) 'OTP content test failed'
Invoke-Node @((Join-Path $repo 'scripts\test_auth_timeout_state.mjs')) 'OAuth timeout state regression test failed'
Invoke-Node @((Join-Path $repo 'scripts\test_auth_multi_account.mjs')) 'Consecutive multi-account OAuth regression test failed'
Invoke-Node @((Join-Path $repo 'scripts\test_auth_diagnostics.mjs')) 'OAuth diagnostics visibility test failed'
Invoke-Node @((Join-Path $repo 'scripts\verify_refresh_recovery.mjs')) 'Queue refresh recovery contract failed'

$manifestText = [System.IO.File]::ReadAllText((Join-Path $extension 'manifest.json'), [System.Text.Encoding]::UTF8)
$version = [regex]::Match($manifestText, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
if (-not $version) { throw 'Cannot read extension version from manifest.json' }
$zip = Join-Path $dist "cpa-reauth-helper-extension-v$version.zip"
Compress-Archive -Path (Join-Path $extension '*') -DestinationPath $zip -Force

$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS'), "$hash  $(Split-Path $zip -Leaf)`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "Extension build: PASS"
Write-Host "Package: $zip"
