param(
  [ValidateSet('menu', 'install', 'normal', 'relay-fail', 'wizard-reset', 'wizard-force', 'p0-acceptance', 'cleanup')]
  [string]$Scenario = 'menu'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WizardFlag = Join-Path $env:LOCALAPPDATA "AssetCutterCompanion\desktop-shell\first-run-complete"
$AcceptanceReportPath = Join-Path $RepoRoot "docs\本地伴侣-P0验收记录.md"

function Enter-RepoRoot {
  Set-Location $RepoRoot
}

function Clear-CompanionTestEnv {
  foreach ($name in @(
      'COMPANION_RELAY_CMD',
      'COMPANION_SHARED_TOKEN',
      'COMPANION_DESKTOP_FORCE_WIZARD',
      'COMPANION_DESKTOP_SKIP_WIZARD'
    )) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}

function Start-CompanionDesktop {
  Enter-RepoRoot
  Write-Host ""
  Write-Host "Starting companion-desktop..." -ForegroundColor Cyan
  Write-Host "Checkpoints:" -ForegroundColor Yellow
  Write-Host "1) Tray icon appears"
  Write-Host "2) Context menu has status/restart/open-console"
  Write-Host "3) Left-click tray opens console"
  Write-Host ""
  & npm.cmd run companion-desktop:start
}

function Install-AllDeps {
  Enter-RepoRoot
  Write-Host "Installing root dependencies..." -ForegroundColor Cyan
  & npm.cmd install
  Set-Location (Join-Path $RepoRoot 'local-companion')
  Write-Host "Installing local-companion dependencies..." -ForegroundColor Cyan
  & npm.cmd install
  Set-Location (Join-Path $RepoRoot 'companion-desktop')
  Write-Host "Installing companion-desktop dependencies..." -ForegroundColor Cyan
  & npm.cmd install
  Enter-RepoRoot
  Write-Host "Dependency install complete." -ForegroundColor Green
}

function Invoke-Normal {
  Clear-CompanionTestEnv
  Write-Host "Scenario: normal startup regression" -ForegroundColor Green
  Start-CompanionDesktop
}

function Invoke-RelayFail {
  Clear-CompanionTestEnv
  $env:COMPANION_RELAY_CMD = 'not-a-real-command'
  Write-Host "Scenario: relay failure mapping (COMPANION_RELAY_CMD=not-a-real-command)" -ForegroundColor Green
  Write-Host "Expected: after ~12-20s tray shows relay-not-running warning." -ForegroundColor Yellow
  Start-CompanionDesktop
}

function Invoke-WizardReset {
  Clear-CompanionTestEnv
  if (Test-Path $WizardFlag) {
    Remove-Item $WizardFlag -Force
    Write-Host "Deleted first-run marker: $WizardFlag" -ForegroundColor Green
  } else {
    Write-Host "First-run marker not found: $WizardFlag" -ForegroundColor DarkYellow
  }
  Write-Host "Scenario: first-run wizard reset" -ForegroundColor Green
  Start-CompanionDesktop
}

function Invoke-WizardForce {
  Clear-CompanionTestEnv
  $env:COMPANION_DESKTOP_FORCE_WIZARD = '1'
  Write-Host "Scenario: force wizard each launch (COMPANION_DESKTOP_FORCE_WIZARD=1)" -ForegroundColor Green
  Start-CompanionDesktop
}

function Read-ChecklistAnswer {
  param(
    [string]$Prompt
  )
  while ($true) {
    $raw = (Read-Host "$Prompt (y/n/na)").Trim().ToLowerInvariant()
    switch ($raw) {
      'y' { return 'PASS' }
      'n' { return 'FAIL' }
      'na' { return 'N/A' }
      default { Write-Host "Please input y / n / na." -ForegroundColor Yellow }
    }
  }
}

function Invoke-P0Acceptance {
  Enter-RepoRoot
  Write-Host ""
  Write-Host "=== P0 acceptance guided checklist ===" -ForegroundColor Cyan
  Write-Host "Run companion-desktop in another terminal first." -ForegroundColor Yellow
  Write-Host "When each check is done, answer y/n/na here."
  Write-Host ""
  Write-Host "Suggested startup command:" -ForegroundColor DarkCyan
  Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File `"scripts/test-companion-desktop.ps1`" -Scenario normal"
  Write-Host ""

  $results = [ordered]@{}
  $results['Tray can open console'] = Read-ChecklistAnswer -Prompt "Tray left click and menu open console"
  $results['Main window opens from tray'] = Read-ChecklistAnswer -Prompt "Tray menu item 'Open main window' works"
  $results['Quit stops child process'] = Read-ChecklistAnswer -Prompt "After tray quit, local-companion child process is stopped"
  $results['Wizard reappears after deleting marker'] = Read-ChecklistAnswer -Prompt "Delete first-run marker then restart and wizard appears again"
  $results['Wizard complete hides next launch'] = Read-ChecklistAnswer -Prompt "Click wizard complete then restart and wizard no longer auto-opens"
  $results['Pairing config saved'] = Read-ChecklistAnswer -Prompt "Wizard token/origin save works"
  $results['Pairing config injected'] = Read-ChecklistAnswer -Prompt "Saved token/origin affects runtime behavior after restart"
  $results['Relay warning balloon'] = Read-ChecklistAnswer -Prompt "relay-fail scenario shows tray warning balloon"
  $results['Token mismatch warning'] = Read-ChecklistAnswer -Prompt "401/token mismatch scenario shows tray warning balloon"

  $note = Read-Host "Optional note"
  $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $passCount = ($results.Values | Where-Object { $_ -eq 'PASS' }).Count
  $failCount = ($results.Values | Where-Object { $_ -eq 'FAIL' }).Count
  $naCount = ($results.Values | Where-Object { $_ -eq 'N/A' }).Count

  $lines = @()
  $lines += ""
  $lines += "## $now"
  $lines += ""
  $lines += "- Summary: PASS=$passCount, FAIL=$failCount, N/A=$naCount"
  foreach ($k in $results.Keys) {
    $lines += "- ${k}: $($results[$k])"
  }
  if ($note) {
    $lines += "- Note: $note"
  }
  $lines += ""

  if (-not (Test-Path $AcceptanceReportPath)) {
    $header = @(
      "# 本地伴侣 P0 验收记录",
      "",
      "Generated by scripts/test-companion-desktop.ps1 -Scenario p0-acceptance.",
      ""
    )
    Set-Content -Path $AcceptanceReportPath -Value $header -Encoding UTF8
  }
  Add-Content -Path $AcceptanceReportPath -Value $lines -Encoding UTF8
  Write-Host ""
  Write-Host "Acceptance report updated: $AcceptanceReportPath" -ForegroundColor Green
}

function Show-Menu {
  Enter-RepoRoot
  Write-Host ""
  Write-Host "=== companion-desktop test runner ===" -ForegroundColor Cyan
  Write-Host "Repo: $RepoRoot"
  Write-Host "1) install      install all dependencies (first run)"
  Write-Host "2) normal       normal startup regression"
  Write-Host "3) relay-fail   relay warning scenario"
  Write-Host "4) wizard-reset delete marker then verify first-run wizard"
  Write-Host "5) wizard-force force wizard every launch"
  Write-Host "6) p0-acceptance guided checklist + report"
  Write-Host "7) cleanup      clear test env vars"
  Write-Host "0) exit"
  Write-Host ""

  $choice = Read-Host "Choose option"
  switch ($choice) {
    '1' { Install-AllDeps }
    '2' { Invoke-Normal }
    '3' { Invoke-RelayFail }
    '4' { Invoke-WizardReset }
    '5' { Invoke-WizardForce }
    '6' { Invoke-P0Acceptance }
    '7' {
      Clear-CompanionTestEnv
      Write-Host "Test env vars cleared." -ForegroundColor Green
    }
    default { return }
  }
}

switch ($Scenario) {
  'install' { Install-AllDeps }
  'normal' { Invoke-Normal }
  'relay-fail' { Invoke-RelayFail }
  'wizard-reset' { Invoke-WizardReset }
  'wizard-force' { Invoke-WizardForce }
  'p0-acceptance' { Invoke-P0Acceptance }
  'cleanup' {
    Clear-CompanionTestEnv
    Write-Host "Test env vars cleared." -ForegroundColor Green
  }
  default { Show-Menu }
}
