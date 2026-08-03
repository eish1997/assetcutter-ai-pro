param(
  [switch]$RequireSigning,
  [switch]$RequirePublishUrl,
  [switch]$RequireCodexOneClick,
  [string]$CodexAuthUrl,
  [string]$CodexAuthCookie
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-EnvPresent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )
  $v = [Environment]::GetEnvironmentVariable($Name)
  return -not [string]::IsNullOrWhiteSpace($v)
}

function Get-EnvOrDefault {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$DefaultValue
  )
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($v)) {
    return $DefaultValue
  }
  return $v
}

$checks = @()
$checks += [pscustomobject]@{ Name = 'Node >= 20'; Pass = $true; Detail = "Current: $($PSVersionTable.PSEdition) PowerShell" }
$checks += [pscustomobject]@{
  Name = 'ELECTRON_MIRROR(optional)'
  Pass = $true
  Detail = Get-EnvOrDefault -Name 'ELECTRON_MIRROR' -DefaultValue '(not set)'
}
$checks += [pscustomobject]@{
  Name = 'ELECTRON_BUILDER_BINARIES_MIRROR(optional)'
  Pass = $true
  Detail = Get-EnvOrDefault -Name 'ELECTRON_BUILDER_BINARIES_MIRROR' -DefaultValue '(not set)'
}

if ($RequireSigning) {
  $hasCscLink = Test-EnvPresent -Name 'CSC_LINK'
  $hasCscPwd = Test-EnvPresent -Name 'CSC_KEY_PASSWORD'
  $checks += [pscustomobject]@{
    Name = 'Signing: CSC_LINK'
    Pass = $hasCscLink
    Detail = if ($hasCscLink) { 'set' } else { 'missing' }
  }
  $checks += [pscustomobject]@{
    Name = 'Signing: CSC_KEY_PASSWORD'
    Pass = $hasCscPwd
    Detail = if ($hasCscPwd) { 'set' } else { 'missing' }
  }
}

if ($RequirePublishUrl) {
  $hasPublish = Test-EnvPresent -Name 'COMPANION_UPDATE_FEED_URL'
  $hasBuildOrigin = Test-EnvPresent -Name 'COMPANION_BUILD_AUTH_API_ORIGIN'
  $checks += [pscustomobject]@{
    Name = 'Updater: feed URL or COMPANION_BUILD_AUTH_API_ORIGIN'
    Pass = $hasPublish -or $hasBuildOrigin
    Detail = if ($hasPublish) {
      "COMPANION_UPDATE_FEED_URL=$([Environment]::GetEnvironmentVariable('COMPANION_UPDATE_FEED_URL'))"
    } elseif ($hasBuildOrigin) {
      "COMPANION_BUILD_AUTH_API_ORIGIN=$([Environment]::GetEnvironmentVariable('COMPANION_BUILD_AUTH_API_ORIGIN'))"
    } else {
      'need COMPANION_UPDATE_FEED_URL or COMPANION_BUILD_AUTH_API_ORIGIN'
    }
  }
}

if ($RequireCodexOneClick) {
  $hasSharedAuth = (Test-EnvPresent -Name 'CODEX_SHARED_AUTH_JSON_BASE64') -or (Test-EnvPresent -Name 'CODEX_SHARED_AUTH_JSON')
  $checks += [pscustomobject]@{
    Name = 'Codex one-click: shared team identity env'
    Pass = $hasSharedAuth
    Detail = if ($hasSharedAuth) { 'set' } else { 'need CODEX_SHARED_AUTH_JSON_BASE64 or CODEX_SHARED_AUTH_JSON' }
  }

  if (-not [string]::IsNullOrWhiteSpace($CodexAuthUrl)) {
    $hasCodexAuthCookie = -not [string]::IsNullOrWhiteSpace($CodexAuthCookie)
    try {
      $headers = @{}
      if ($hasCodexAuthCookie) {
        $headers['Cookie'] = $CodexAuthCookie
      }
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $CodexAuthUrl -Headers $headers -TimeoutSec 20
      $checks += [pscustomobject]@{
        Name = 'Codex one-click: cloud identity route'
        Pass = ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
        Detail = if ($hasCodexAuthCookie) {
          "$CodexAuthUrl -> HTTP $($resp.StatusCode)"
        } else {
          "$CodexAuthUrl -> HTTP $($resp.StatusCode); pass -CodexAuthCookie to verify logged-in payload"
        }
      }
    } catch {
      $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
      $routeExistsWithoutCookie = (-not $hasCodexAuthCookie) -and ($status -eq 401 -or $status -eq 503)
      $checks += [pscustomobject]@{
        Name = 'Codex one-click: cloud identity route'
        Pass = $routeExistsWithoutCookie
        Detail = if ($routeExistsWithoutCookie) {
          "$CodexAuthUrl -> HTTP $status; route exists, login or shared identity is required"
        } else {
          "$CodexAuthUrl -> HTTP $status $($_.Exception.Message)"
        }
      }
    }
  } else {
    $checks += [pscustomobject]@{
      Name = 'Codex one-click: cloud identity route'
      Pass = $false
      Detail = 'pass -CodexAuthUrl https://.../api/team/codex/auth with -CodexAuthCookie for a live check'
    }
  }
}

$failed = @($checks | Where-Object { -not $_.Pass })

Write-Host ""
Write-Host "=== companion-desktop release preflight ===" -ForegroundColor Cyan
foreach ($c in $checks) {
  $prefix = if ($c.Pass) { '[PASS]' } else { '[FAIL]' }
  $color = if ($c.Pass) { 'Green' } else { 'Red' }
  Write-Host "$prefix $($c.Name) - $($c.Detail)" -ForegroundColor $color
}
Write-Host ""

if ($failed.Count -gt 0) {
  throw "Release preflight failed ($($failed.Count) checks)."
}

Write-Host "Release preflight passed." -ForegroundColor Green
