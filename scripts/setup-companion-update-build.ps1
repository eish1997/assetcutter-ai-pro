# 写入 companion-desktop/build-constants.json 并执行发布前检查
param(
  [string]$AuthApiOrigin = 'https://assetcutter-auth-api.onrender.com'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$env:COMPANION_BUILD_AUTH_API_ORIGIN = $AuthApiOrigin.Trim().TrimEnd('/')
npm run companion-desktop:write-build-constants
Write-Host ""
powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\scripts\verify-companion-update-pipeline.ps1" -AuthApiOrigin $env:COMPANION_BUILD_AUTH_API_ORIGIN
