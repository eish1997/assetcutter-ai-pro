# 校验线上/本地伴侣自动更新链路：auth-api health、latest、electron-updater latest.yml
# 用法:
#   powershell -File scripts/verify-companion-update-pipeline.ps1
#   powershell -File scripts/verify-companion-update-pipeline.ps1 -AuthApiOrigin https://assetcutter-auth-api.onrender.com

param(
  [string]$AuthApiOrigin = 'https://assetcutter-auth-api.onrender.com'
)

$ErrorActionPreference = 'Stop'
$base = $AuthApiOrigin.Trim().TrimEnd('/')

function Get-Url($path) {
  return "$base$path"
}

function Test-YamlLooksValid($content) {
  if (-not $content) { return $false }
  if ($content -match '(?m)^\s*#\s*error:') { return $false }
  if ($content -notmatch '(?m)^\s*version\s*:') { return $false }
  if ($content -notmatch '(?m)^\s*files\s*:') { return $false }
  return $true
}

function Test-Endpoint($name, $url, [switch]$RequireValidYaml) {
  Write-Host "`n== $name ==" -ForegroundColor Cyan
  Write-Host $url
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
    Write-Host "HTTP $($r.StatusCode)" -ForegroundColor Green
    $preview = $r.Content
    if ($RequireValidYaml -and -not (Test-YamlLooksValid $preview)) {
      Write-Host 'FAIL: body is not valid electron-updater YAML (missing version/files or contains # error:)' -ForegroundColor Red
      if ($preview.Length -gt 400) { $preview = $preview.Substring(0, 400) + '...' }
      Write-Host $preview
      return $false
    }
    if ($preview.Length -gt 400) { $preview = $preview.Substring(0, 400) + '...' }
    Write-Host $preview
    return $true
  } catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
        if ($body) { Write-Host $body }
      } catch { }
    }
    return $false
  }
}

$okHealth = Test-Endpoint 'healthz' (Get-Url '/healthz')
$okLatest = Test-Endpoint 'latest desktop_shell' (Get-Url '/api/companion-artifacts/latest?kind=desktop_shell&platform=win32&channel=stable')
$okYml = Test-Endpoint 'electron-updater latest.yml (Path A)' (Get-Url '/api/companion-artifacts/electron-updater/win32/stable/latest.yml') -RequireValidYaml
$okYmlLegacy = Test-Endpoint 'electron-app-update.yml (legacy)' (Get-Url '/api/companion-artifacts/electron-app-update.yml?kind=desktop_shell&platform=win32&channel=stable') -RequireValidYaml

$feed = Get-Url '/api/companion-artifacts/electron-updater/win32/stable'
Write-Host "`n== 建议打包变量 ==" -ForegroundColor Cyan
Write-Host "`$env:COMPANION_BUILD_AUTH_API_ORIGIN = '$base'"
Write-Host "feed (electron-updater): $feed"

if (-not $okYml) {
  Write-Host ''
  if ($okYmlLegacy) {
    Write-Host "[WARN] Path A latest.yml not ready; legacy yml OK. Deploy auth-api with electron-updater route before testing packaged app." -ForegroundColor Yellow
  } else {
    Write-Host "[WARN] Update YAML not ready. On Render assetcutter-auth-api set:" -ForegroundColor Yellow
    Write-Host "    R2_PUBLIC_BASE_URL or COMPANION_DIST_PUBLIC_HTTP_BASE (public read prefix, no trailing slash)" -ForegroundColor Yellow
    Write-Host "    and register desktop_shell win32 stable artifact with sha512" -ForegroundColor Yellow
  }
  Write-Host "    Save env vars, redeploy, then run this script again." -ForegroundColor Yellow
  exit 1
}

Write-Host ''
if (-not $okYmlLegacy) {
  Write-Host "[OK] Path A auto-update feed is live." -ForegroundColor Green
} else {
  Write-Host "[OK] Path A and legacy YAML are both available." -ForegroundColor Green
}
exit 0
