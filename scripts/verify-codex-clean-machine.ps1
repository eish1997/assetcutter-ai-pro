param(
  [string]$AuthBase = "https://assetcutter-auth-api.onrender.com",
  [string]$CompanionUrl = "http://127.0.0.1:18765/v1/health",
  [string]$Cookie = "",
  [string]$DesktopVersion = "",
  [string]$InstallerPath = "",
  [string]$Out = "",
  [int]$CompanionWaitSeconds = 90,
  [int]$CodexSetupWaitSeconds = 600,
  [switch]$Strict,
  [switch]$SkipConversationSmoke,
  [switch]$LaunchInstaller,
  [switch]$AutoCodexSetup
)

$ErrorActionPreference = "Stop"

function New-Check {
  param([string]$Section, [string]$Id, [string]$Label, [string]$Level, [string]$Detail)
  [pscustomobject]@{
    section = $Section
    id = $Id
    label = $Label
    level = $Level
    detail = $Detail
  }
}

function Get-CompanionCodexPathDirs {
  $dirs = @()
  if ($env:LOCALAPPDATA) {
    $runtimeRoot = Join-Path $env:LOCALAPPDATA "AssetCutterCompanion\sandbox\runtimes"
    $dirs += (Join-Path $runtimeRoot "codex-npm-global")
    $portableRoot = Join-Path $runtimeRoot "codex-node"
    if (Test-Path -LiteralPath $portableRoot) {
      Get-ChildItem -LiteralPath $portableRoot -Directory -Filter "node-v*" -ErrorAction SilentlyContinue | ForEach-Object {
        $dirs += $_.FullName
      }
    }
  }
  return @($dirs | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
}

function Invoke-WithCompanionCodexPath {
  param([scriptblock]$Script)
  $oldPath = $env:Path
  try {
    $extra = Get-CompanionCodexPathDirs
    if ($extra.Count -gt 0) {
      $env:Path = (($extra + @($oldPath)) -join [IO.Path]::PathSeparator)
    }
    return & $Script
  } finally {
    $env:Path = $oldPath
  }
}

function Invoke-Get {
  param([string]$Url, [hashtable]$Headers = @{})
  $body = ""
  try {
    $response = Invoke-WebRequest -Uri $Url -Method GET -Headers $Headers -TimeoutSec 20 -UseBasicParsing
    $body = [string]$response.Content
    return [pscustomobject]@{
      ok = [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
      status = [int]$response.StatusCode
      body = $body
      detail = $body.Substring(0, [Math]::Min(500, $body.Length))
    }
  } catch {
    $status = 0
    $detail = $_.Exception.Message
    $response = $_.Exception.Response
    if ($response) {
      try {
        $status = [int]$response.StatusCode
      } catch {
        $status = 0
      }
      try {
        $stream = $response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $body = $reader.ReadToEnd()
          $reader.Close()
          if ($body) {
            $detail = $body.Substring(0, [Math]::Min(500, $body.Length))
          }
        }
      } catch {
        if (!$detail) { $detail = $_.Exception.Message }
      }
    }
    return [pscustomobject]@{ ok = $false; status = $status; body = $body; detail = $detail }
  }
}

function Test-CodexAuthPayload {
  param($Response)
  if (!$Response.ok) {
    return New-Check "production" "codex_auth_payload" "Codex identity payload with login" "fail" "$($Response.status): $($Response.detail)"
  }
  try {
    $payload = $Response.body | ConvertFrom-Json
    $value = $payload
    if ($payload.PSObject.Properties.Name -contains "authJsonBase64") {
      $bytes = [Convert]::FromBase64String([string]$payload.authJsonBase64)
      $value = [Text.Encoding]::UTF8.GetString($bytes)
    } elseif ($payload.PSObject.Properties.Name -contains "authJson") {
      $value = $payload.authJson
    }
    if ($value -is [string]) {
      $value = $value | ConvertFrom-Json
    }
    if (!$value -or $value -is [array]) {
      return New-Check "production" "codex_auth_payload" "Codex identity payload with login" "fail" "$($Response.status): auth payload does not contain a JSON object"
    }
    return New-Check "production" "codex_auth_payload" "Codex identity payload with login" "ok" "$($Response.status): valid Codex auth payload"
  } catch {
    return New-Check "production" "codex_auth_payload" "Codex identity payload with login" "fail" "$($Response.status): invalid Codex auth payload: $($_.Exception.Message)"
  }
}

function Test-CommandVersion {
  param([string]$Command)
  try {
    $output = Invoke-WithCompanionCodexPath { & $Command --version 2>&1 }
    $code = $LASTEXITCODE
    return [pscustomobject]@{ ok = $code -eq 0; detail = (($output | Out-String).Trim()); command = $Command }
  } catch {
    return [pscustomobject]@{ ok = $false; detail = $_.Exception.Message; command = $Command }
  }
}

function Get-CompanionCodexPathCandidates {
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $runtimeRoot = Join-Path $env:LOCALAPPDATA "AssetCutterCompanion\sandbox\runtimes"
    $candidates += (Join-Path $runtimeRoot "codex-npm-global\codex.cmd")
    $portableRoot = Join-Path $runtimeRoot "codex-node"
    if (Test-Path -LiteralPath $portableRoot) {
      Get-ChildItem -LiteralPath $portableRoot -Directory -Filter "node-v*" -ErrorAction SilentlyContinue | ForEach-Object {
        $candidates += (Join-Path $_.FullName "codex.cmd")
      }
    }
  }
  return $candidates
}

function Find-CodexCommand {
  $candidates = @("codex.cmd", "codex")
  $candidates += Get-CompanionCodexPathCandidates
  if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA "npm\codex.cmd") }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles "nodejs\codex.cmd") }
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} "nodejs\codex.cmd") }
  foreach ($candidate in $candidates) {
    if ($candidate -match "\\|/" -and !(Test-Path -LiteralPath $candidate)) { continue }
    $probe = Test-CommandVersion $candidate
    if ($probe.ok) { return $probe }
  }
  return Test-CommandVersion "codex.cmd"
}

function Get-DesktopVersionFromInstallerName {
  param([string]$Path)
  if (!$Path) { return "" }
  $name = Split-Path -Leaf $Path
  if ($name -match '^AssetCutterCompanion-(\d+\.\d+\.\d+)-.+-x64\.exe$') {
    return $Matches[1]
  }
  return ""
}

function Find-CompanionInstaller {
  if ($InstallerPath -and (Test-Path -LiteralPath $InstallerPath)) {
    return (Resolve-Path -LiteralPath $InstallerPath).Path
  }
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $pattern = if ($DesktopVersion) { "AssetCutterCompanion-$DesktopVersion-*-x64.exe" } else { "AssetCutterCompanion-*-x64.exe" }
  $hit = Get-ChildItem -LiteralPath $scriptDir -File -Filter $pattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return ""
}

function Test-CompanionInstaller {
  param([string]$Path)
  if (!$Path) {
    return New-Check "local" "desktop_installer_package" "Desktop installer package" "warn" "No sibling AssetCutterCompanion installer found next to this script"
  }
  return New-Check "local" "desktop_installer_package" "Desktop installer package" "ok" $Path
}

function Start-CompanionInstaller {
  param([string]$Path)
  if (!$Path -or !(Test-Path -LiteralPath $Path)) {
    return New-Check "local" "desktop_installer_launch" "Launch desktop installer" "fail" "Installer not found; pass -InstallerPath or put this script next to AssetCutterCompanion-$DesktopVersion-*-x64.exe"
  }
  try {
    Start-Process -FilePath $Path
    return New-Check "local" "desktop_installer_launch" "Launch desktop installer" "ok" "Installer launched: $Path"
  } catch {
    return New-Check "local" "desktop_installer_launch" "Launch desktop installer" "fail" $_.Exception.Message
  }
}

function Find-InstalledCompanionApp {
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\AssetCutterCompanion\AssetCutterCompanion.exe")
  }
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "AssetCutterCompanion\AssetCutterCompanion.exe")
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "AssetCutterCompanion\AssetCutterCompanion.exe")
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return ""
}

function Start-InstalledCompanionApp {
  param([switch]$AutoCodexSetup)
  $appPath = Find-InstalledCompanionApp
  if (!$appPath) {
    return New-Check "local" "desktop_app_launch" "Launch installed companion" "warn" "Installed AssetCutterCompanion.exe was not found yet; finish the installer, open Companion, then rerun this script"
  }
  try {
    if ($AutoCodexSetup) {
      Start-Process -FilePath $appPath -ArgumentList "--assetcutter-codex-one-click-setup"
      return New-Check "local" "desktop_app_launch" "Launch installed companion" "ok" "Companion launched with Codex one-click setup: $appPath"
    }
    Start-Process -FilePath $appPath
    return New-Check "local" "desktop_app_launch" "Launch installed companion" "ok" "Companion launched: $appPath"
  } catch {
    return New-Check "local" "desktop_app_launch" "Launch installed companion" "warn" $_.Exception.Message
  }
}

function Wait-CompanionHealth {
  param([string]$Url, [int]$TimeoutSeconds = 90)
  $deadline = (Get-Date).AddSeconds([Math]::Max(5, $TimeoutSeconds))
  $last = [pscustomobject]@{ ok = $false; status = 0; detail = "not checked" }
  while ((Get-Date) -lt $deadline) {
    $last = Invoke-Get $Url
    if ($last.ok) {
      return New-Check "local" "local_companion_wait" "Wait for local companion" "ok" "$($last.status): $($last.detail)"
    }
    Start-Sleep -Seconds 3
  }
  return New-Check "local" "local_companion_wait" "Wait for local companion" "warn" "$($last.status): $($last.detail)"
}

function Read-OneClickReportFromSettings {
  $settingsPath = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "AssetCutterCompanion\sandbox\agent-store\settings.json"
  } else {
    ""
  }
  if (!$settingsPath -or !(Test-Path -LiteralPath $settingsPath)) {
    return [pscustomobject]@{ settingsPath = $settingsPath; report = $null }
  }
  try {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    return [pscustomobject]@{ settingsPath = $settingsPath; report = $settings.codexLastSetupReport }
  } catch {
    return [pscustomobject]@{ settingsPath = $settingsPath; report = $null }
  }
}

function Test-OneClickReportNeedsLoginWait {
  param($Report)
  if (!$Report -or $Report.ok) { return $false }
  $failed = @($Report.failed)
  if (!($failed -contains "cloud_identity")) { return $false }
  $checks = @($Report.checks)
  foreach ($check in $checks) {
    if ([string]$check.id -ne "cloud_identity") { continue }
    $detail = [string]$check.detail
    if ($detail.StartsWith("http_401")) { return $true }
  }
  return $false
}

function Wait-CodexOneClickSetupReport {
  param([int]$TimeoutSeconds = 600, [datetime]$StartedAfter = [datetime]::MinValue)
  $deadline = (Get-Date).AddSeconds([Math]::Max(10, $TimeoutSeconds))
  $sawLoginWait = $false
  while ((Get-Date) -lt $deadline) {
    $state = Read-OneClickReportFromSettings
    $report = $state.report
    if ($report -and [string]$report.desktopVersion -eq $DesktopVersion) {
      $reportAt = [datetime]::MinValue
      if ($report.at) {
        try { $reportAt = [datetime]::Parse([string]$report.at).ToUniversalTime() } catch { $reportAt = [datetime]::MinValue }
      }
      if ($reportAt -lt $StartedAfter.ToUniversalTime()) {
        Start-Sleep -Seconds 5
        continue
      }
      if ($report.ok -and $report.cloudIdentitySynced -and $report.conversationVerified) {
        return New-Check "local" "desktop_one_click_setup_wait" "Wait for Codex one-click setup" "ok" "Codex one-click setup completed at $($report.at)"
      }
      if (!$report.ok) {
        if (Test-OneClickReportNeedsLoginWait $report) {
          $sawLoginWait = $true
          Start-Sleep -Seconds 5
          continue
        }
        $failed = if ($report.failed) { ($report.failed -join ", ") } else { "unknown" }
        return New-Check "local" "desktop_one_click_setup_wait" "Wait for Codex one-click setup" "fail" "Codex one-click setup failed at $($report.at): $failed"
      }
    }
    Start-Sleep -Seconds 5
  }
  if ($sawLoginWait) {
    return New-Check "local" "desktop_one_click_setup_wait" "Wait for Codex one-click setup" "warn" "Timed out waiting for Workbench sign-in; finish login in AssetCutter Companion, then rerun this script with -AutoCodexSetup"
  }
  return New-Check "local" "desktop_one_click_setup_wait" "Wait for Codex one-click setup" "warn" "Timed out waiting for current-version Codex one-click setup report; finish setup in the Copilot panel, then rerun this script"
}

function Test-CodexConversation {
  param([string]$Command)
  if ($SkipConversationSmoke) {
    return New-Check "local" "codex_conversation_smoke" "Codex real conversation smoke" "warn" "Skipped; rerun without -SkipConversationSmoke to prove Codex can reply"
  }
  $dir = Join-Path $env:TEMP ("ac-codex-clean-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  try {
    $prompt = "Reply with exactly: assetcutter-codex-ready"
    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $output = Invoke-WithCompanionCodexPath { $prompt | & $Command exec --json --color never --disable plugins --ignore-rules --skip-git-repo-check -C $dir - 2>&1 }
    } finally {
      $ErrorActionPreference = $oldErrorActionPreference
    }
    $text = ($output | Out-String)
    if ($LASTEXITCODE -eq 0 -and $text.ToLowerInvariant().Contains("assetcutter-codex-ready")) {
      return New-Check "local" "codex_conversation_smoke" "Codex real conversation smoke" "ok" "Codex completed a real test conversation via $Command"
    }
    return New-Check "local" "codex_conversation_smoke" "Codex real conversation smoke" "fail" (($text.Trim()).Substring(0, [Math]::Min(500, ($text.Trim()).Length)))
  } finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Read-OneClickReport {
  $settingsPath = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "AssetCutterCompanion\sandbox\agent-store\settings.json"
  } else {
    ""
  }
  if (!$settingsPath -or !(Test-Path -LiteralPath $settingsPath)) {
    return [pscustomobject]@{
      check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "warn" "No desktop one-click setup report found; click one-click Codex setup first"
      settingsPath = $settingsPath
      report = $null
    }
  }
  try {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $report = $settings.codexLastSetupReport
    if (!$report) {
      return [pscustomobject]@{
        check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "warn" "No codexLastSetupReport yet; click one-click Codex setup first"
        settingsPath = $settingsPath
        report = $null
      }
    }
    $reportVersion = [string]$report.desktopVersion
    if ($DesktopVersion -and !$reportVersion) {
      return [pscustomobject]@{
        check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "warn" "Last desktop one-click setup passed at $($report.at), but the report does not record desktop version; rerun one-click setup with desktop $DesktopVersion"
        settingsPath = $settingsPath
        report = $report
      }
    }
    if ($DesktopVersion -and $reportVersion -and $reportVersion -ne $DesktopVersion) {
      return [pscustomobject]@{
        check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "fail" "Last desktop one-click setup report is for desktop $reportVersion, expected $DesktopVersion; rerun one-click setup with the current desktop"
        settingsPath = $settingsPath
        report = $report
      }
    }
    if (!$report.ok) {
      return [pscustomobject]@{
        check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "fail" "Last desktop one-click setup failed"
        settingsPath = $settingsPath
        report = $report
      }
    }
    if (!$report.cloudIdentitySynced) {
      return [pscustomobject]@{
        check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "warn" "Last desktop one-click setup report did not record cloud identity sync; rerun this script with -AutoCodexSetup after signing in"
        settingsPath = $settingsPath
        report = $report
      }
    }
    if (!$report.conversationVerified) {
      return [pscustomobject]@{
        check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "warn" "Last desktop one-click setup report did not record an in-setup conversation verification; click one-click Codex setup and wait for the test conversation to finish"
        settingsPath = $settingsPath
        report = $report
      }
    }
    $level = "ok"
    $detail = "Last desktop one-click setup passed at $($report.at) for desktop $reportVersion with conversation verification"
    return [pscustomobject]@{
      check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" $level $detail
      settingsPath = $settingsPath
      report = $report
    }
  } catch {
    return [pscustomobject]@{
      check = New-Check "local" "desktop_one_click_setup" "Desktop one-click Codex setup report" "fail" $_.Exception.Message
      settingsPath = $settingsPath
      report = $null
    }
  }
}

function Get-NextAction {
  param($Check)
  if ($Check.level -eq "ok") { return "" }
  switch ($Check.id) {
    "local_companion" { return "Install or open AssetCutter Companion, then rerun this script with -AutoCodexSetup." }
    "desktop_installer_package" { return "Put this script next to the AssetCutterCompanion installer, or pass -InstallerPath." }
    "desktop_installer_launch" { return "Open the installer manually, then rerun this script after setup." }
    "desktop_app_launch" { return "Finish the installer, then rerun this script with -AutoCodexSetup." }
    "local_companion_wait" { return "Finish the installer and open AssetCutter Companion; wait until Copilot is visible, then rerun this script." }
    "desktop_one_click_setup_wait" { return "Keep AssetCutter Companion open until the Codex setup progress finishes, then rerun this script." }
    "desktop_one_click_setup" { return "Rerun this script with -AutoCodexSetup, or in AssetCutter Companion's Copilot panel click one-click Codex setup, then rerun this script." }
    "codex_auth_payload" { return "Pass a logged-in team cookie with -Cookie to verify cloud Codex identity payload." }
    "desktop_update_feed" { return "Publish/register the fresh desktop installer so latest.yml includes $DesktopVersion." }
    "codex_conversation_smoke" { return "Run without -SkipConversationSmoke on the test machine." }
    "codex_cli" { return "Install or repair Codex CLI, then click one-click setup again." }
    default { return "Fix this check, then rerun the clean-machine script." }
  }
}

$checks = @()

$installer = Find-CompanionInstaller
if (!$DesktopVersion) {
  $DesktopVersion = Get-DesktopVersionFromInstallerName $installer
}
$checks += Test-CompanionInstaller $installer
if ($LaunchInstaller) {
  $checks += Start-CompanionInstaller $installer
  $waitAfterInstaller = Wait-CompanionHealth $CompanionUrl $CompanionWaitSeconds
  $checks += $waitAfterInstaller
  $autoSetupStartedAt = (Get-Date).ToUniversalTime()
  $checks += Start-InstalledCompanionApp -AutoCodexSetup
  if ($waitAfterInstaller.level -ne "ok") {
    $checks += Wait-CompanionHealth $CompanionUrl $CompanionWaitSeconds
  }
  $checks += Wait-CodexOneClickSetupReport $CodexSetupWaitSeconds $autoSetupStartedAt
} elseif ($AutoCodexSetup) {
  $autoSetupStartedAt = (Get-Date).ToUniversalTime()
  $checks += Start-InstalledCompanionApp -AutoCodexSetup
  $checks += Wait-CompanionHealth $CompanionUrl $CompanionWaitSeconds
  $checks += Wait-CodexOneClickSetupReport $CodexSetupWaitSeconds $autoSetupStartedAt
}

$companion = Invoke-Get $CompanionUrl
$checks += New-Check "local" "local_companion" "Local companion health" $(if ($companion.ok) { "ok" } else { "warn" }) "$($companion.status): $($companion.detail)"

$health = Invoke-Get "$($AuthBase.TrimEnd('/'))/healthz"
$checks += New-Check "production" "auth_health" "auth-api health" $(if ($health.ok) { "ok" } else { "fail" }) "$($health.status): $($health.detail)"

$route = Invoke-Get "$($AuthBase.TrimEnd('/'))/api/team/codex/auth"
$routeOk = $route.ok -or $route.status -eq 401 -or $route.status -eq 503
$checks += New-Check "production" "codex_auth_route" "Codex identity route exists" $(if ($routeOk) { "ok" } else { "fail" }) "$($route.status): $($route.detail)"

if ($Cookie) {
  $payload = Invoke-Get "$($AuthBase.TrimEnd('/'))/api/team/codex/auth" @{ Cookie = $Cookie }
  $checks += Test-CodexAuthPayload $payload
} else {
  $checks += New-Check "production" "codex_auth_payload" "Codex identity payload with login" "warn" "Skipped; pass -Cookie to verify logged-in payload"
}

$feed = Invoke-Get "$($AuthBase.TrimEnd('/'))/api/companion-artifacts/electron-updater/win32/stable/latest.yml"
$feedHasVersion = $feed.ok -and $feed.body.Contains($DesktopVersion)
$checks += New-Check "production" "desktop_update_feed" "Desktop update feed contains target version" $(if ($feedHasVersion) { "ok" } elseif ($feed.ok) { "warn" } else { "fail" }) $(if ($feedHasVersion) { "latest.yml includes $DesktopVersion" } else { "$($feed.status): latest.yml does not include $DesktopVersion" })

$codex = Find-CodexCommand
$checks += New-Check "local" "codex_cli" "Codex CLI" $(if ($codex.ok) { "ok" } else { "warn" }) $codex.detail
$checks += Test-CodexConversation $codex.command

$authPath = Join-Path $HOME ".codex\auth.json"
$checks += New-Check "local" "codex_auth_file" "Local Codex identity file" $(if (Test-Path -LiteralPath $authPath) { "ok" } else { "warn" }) $authPath

$oneClick = Read-OneClickReport
$checks += $oneClick.check

$failed = @($checks | Where-Object { $_.level -eq "fail" })
$warned = @($checks | Where-Object { $_.level -eq "warn" })
$ok = $failed.Count -eq 0 -and (!$Strict -or $warned.Count -eq 0)
$nextActions = @($checks | ForEach-Object {
  $action = Get-NextAction $_
  if ($action) { [pscustomobject]@{ id = $_.id; section = $_.section; level = $_.level; action = $action } }
})

if (!$Out) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $Out = Join-Path $env:TEMP "codex-clean-machine-report-$stamp.json"
}

$report = [pscustomobject]@{
  ok = $ok
  strict = [bool]$Strict
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  authBase = $AuthBase
  companionUrl = $CompanionUrl
  desktopVersion = $DesktopVersion
  installerPath = $installer
  reportPath = (Resolve-Path -LiteralPath (Split-Path -Parent $Out) -ErrorAction SilentlyContinue).Path + "\" + (Split-Path -Leaf $Out)
  agentSettingsPath = $oneClick.settingsPath
  desktopOneClickSetup = $oneClick
  results = $checks
  nextActions = $nextActions
}

New-Item -ItemType Directory -Path (Split-Path -Parent $Out) -Force | Out-Null
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Out -Encoding UTF8

Write-Host "Codex clean-machine acceptance"
Write-Host "desktopVersion: $DesktopVersion"
Write-Host "authBase: $AuthBase"
Write-Host "companion: $CompanionUrl"
if ($installer) { Write-Host "installer: $installer" }
Write-Host "report: $Out"
foreach ($check in $checks) {
  $mark = if ($check.level -eq "ok") { "OK" } elseif ($check.level -eq "warn") { "WARN" } else { "FAIL" }
  Write-Host "[$mark] $($check.section)/$($check.label): $($check.detail)"
}
if ($nextActions.Count) {
  Write-Host "Next actions:"
  foreach ($item in $nextActions) { Write-Host "- $($item.action)" }
}
if ($ok -and $warned.Count -eq 0) {
  Write-Host "Result: clean-machine evidence is complete."
  exit 0
}
if ($ok) {
  Write-Host "Result: clean-machine diagnostic report collected; warnings remain."
  exit 0
}
Write-Host "Result: clean-machine evidence still needs attention."
exit 1
