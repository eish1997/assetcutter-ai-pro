param(
  [ValidateSet('portable', 'win', 'both')]
  [string]$Target = 'portable',
  [int]$Retries = 3,
  [int]$RetryDelaySeconds = 8,
  [switch]$UseMirror
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-DistCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptName
  )
  $attempt = 1
  while ($attempt -le $Retries) {
    Write-Host ""
    Write-Host "[$ScriptName] attempt $attempt/$Retries" -ForegroundColor Cyan
    Set-Location $RepoRoot
    & npm.cmd run $ScriptName
    if ($LASTEXITCODE -eq 0) {
      Write-Host "[$ScriptName] success." -ForegroundColor Green
      return
    }

    if ($attempt -ge $Retries) {
      throw "[$ScriptName] failed after $Retries attempts."
    }
    Write-Host "[$ScriptName] failed, retry in $RetryDelaySeconds s..." -ForegroundColor Yellow
    Start-Sleep -Seconds $RetryDelaySeconds
    $attempt++
  }
}

function Set-MirrorEnvIfNeeded {
  if (-not $UseMirror) {
    return
  }
  # Mirrors commonly used in CN network environments.
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  Write-Host "Mirror enabled:" -ForegroundColor DarkCyan
  Write-Host "  ELECTRON_MIRROR=$($env:ELECTRON_MIRROR)"
  Write-Host "  ELECTRON_BUILDER_BINARIES_MIRROR=$($env:ELECTRON_BUILDER_BINARIES_MIRROR)"
}

Set-MirrorEnvIfNeeded

switch ($Target) {
  'portable' {
    Invoke-DistCommand -ScriptName 'companion-desktop:dist:portable'
  }
  'win' {
    Invoke-DistCommand -ScriptName 'companion-desktop:dist:win'
  }
  'both' {
    Invoke-DistCommand -ScriptName 'companion-desktop:dist:portable'
    Invoke-DistCommand -ScriptName 'companion-desktop:dist:win'
  }
}

Write-Host ""
Write-Host "Done. Check output in companion-desktop/release/." -ForegroundColor Green
