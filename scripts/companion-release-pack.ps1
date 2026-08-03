# Fixed release pack for desktop companion + shell_tool_bundle ZIPs.
# Usage (repo root):
#   npm run companion-desktop:release:pack
#   powershell -File scripts/companion-release-pack.ps1 -BumpPatch
#   powershell -File scripts/companion-release-pack.ps1 -ShellTools transfer-maps-batch -SkipRestart
#
# Outputs:
#   companion-desktop/dist-out-<verNoDots>/installer/   (NSIS + blockmap by default)
#   dist-out-shell-tools/<id>-<semver>.zip

param(
  [switch]$BumpPatch,
  [string]$Version = '',
  [ValidateSet('win', 'portable', 'both')]
  [string]$Target = 'win',
  [string]$ShellTools = '',
  [string]$AuthApiOrigin = 'https://assetcutter-auth-api.onrender.com',
  [switch]$SkipRestart,
  [switch]$NoMirror,
  [int]$Retries = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$pkgPath = Join-Path $RepoRoot 'companion-desktop\package.json'
if (-not (Test-Path -LiteralPath $pkgPath)) {
  throw "Missing $pkgPath"
}

function Get-PackageVersion {
  $raw = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8
  if ($raw -notmatch '"version"\s*:\s*"([^"]+)"') {
    throw 'Cannot read companion-desktop package.json version'
  }
  return $Matches[1]
}

function Set-PackageVersion([string]$next) {
  if ($next -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid semver: $next"
  }
  $raw = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8
  $updated = [regex]::Replace($raw, '("version"\s*:\s*")[^"]+(")', "`${1}$next`${2}", 1)
  [System.IO.File]::WriteAllText($pkgPath, $updated, [System.Text.UTF8Encoding]::new($false))
}

function Bump-PatchVersion([string]$cur) {
  $parts = $cur.Split('.')
  if ($parts.Count -lt 3) { throw "Cannot bump version: $cur" }
  $patch = [int]$parts[2] + 1
  return "$($parts[0]).$($parts[1]).$patch"
}

function Stop-CompanionProcesses {
  Write-Host '[release-pack] Stopping companion / electron...' -ForegroundColor DarkCyan
  Get-Process electron, AssetCutterCompanion -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*paddleocr-service*server.py*' } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  foreach ($port in @(18765, 18082)) {
    $pids = @(
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
    foreach ($procId in $pids) {
      if ($procId -gt 0) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Start-Sleep -Seconds 2
}

function Write-Sha256Sums([string]$Dir, [string[]]$Names) {
  if (-not (Test-Path -LiteralPath $Dir)) { return }
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($name in $Names) {
    $p = Join-Path $Dir $name
    if (-not (Test-Path -LiteralPath $p)) { continue }
    $hash = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines.Add("$hash  $name")
  }
  if ($lines.Count -eq 0) { return }
  $out = Join-Path $Dir 'SHA256SUMS.txt'
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllLines($out, $lines.ToArray(), $utf8)
  Write-Host "[release-pack] Wrote $out" -ForegroundColor DarkCyan
}

# --- version ---
$cur = Get-PackageVersion
if ($BumpPatch) {
  $next = Bump-PatchVersion $cur
  Set-PackageVersion $next
  $cur = $next
  Write-Host "[release-pack] Bumped companion-desktop version → $cur" -ForegroundColor Green
}
elseif (-not [string]::IsNullOrWhiteSpace($Version)) {
  Set-PackageVersion $Version.Trim()
  $cur = Get-PackageVersion
  Write-Host "[release-pack] Set companion-desktop version → $cur" -ForegroundColor Green
}
else {
  Write-Host "[release-pack] Using companion-desktop version $cur" -ForegroundColor DarkCyan
}

$outRootName = 'dist-out-' + ($cur -replace '\.', '')
$env:COMPANION_BUILD_OUTPUT_ROOT = $outRootName
$env:COMPANION_BUILD_AUTH_API_ORIGIN = $AuthApiOrigin.Trim().TrimEnd('/')
Write-Host "[release-pack] COMPANION_BUILD_OUTPUT_ROOT=$outRootName" -ForegroundColor DarkCyan
Write-Host "[release-pack] COMPANION_BUILD_AUTH_API_ORIGIN=$($env:COMPANION_BUILD_AUTH_API_ORIGIN)" -ForegroundColor DarkCyan

Write-Host '[release-pack] Checking build.files covers main.cjs require graph...' -ForegroundColor DarkCyan
$nodeExe = (Get-Command node -ErrorAction Stop).Source
& $nodeExe (Join-Path $PSScriptRoot 'check-companion-desktop-asar-files.mjs')
if ($LASTEXITCODE -ne 0) {
  throw 'check-companion-desktop-asar-files failed — fix companion-desktop/package.json build.files'
}

Stop-CompanionProcesses

$distArgs = @{
  Target  = $Target
  Retries = $Retries
}
if (-not $NoMirror) {
  $distArgs['UseMirror'] = $true
}

& (Join-Path $PSScriptRoot 'companion-desktop-dist.ps1') @distArgs
if ($LASTEXITCODE -ne 0) {
  throw "companion-desktop-dist.ps1 failed with exit $LASTEXITCODE"
}

# --- verify Maya bridge shipped in unpacked resources ---
$unpackedBridge = Join-Path $RepoRoot "companion-desktop\$outRootName\installer\win-unpacked\resources\local-companion-bundle\maya-plugins\script-hub-bridge\script_hub_bridge.py"
if ($Target -eq 'portable') {
  $unpackedBridge = Join-Path $RepoRoot "companion-desktop\$outRootName\portable\win-unpacked\resources\local-companion-bundle\maya-plugins\script-hub-bridge\script_hub_bridge.py"
}
if (($Target -eq 'win' -or $Target -eq 'both') -and -not (Test-Path -LiteralPath $unpackedBridge)) {
  # nsis output layout
  $alt = Join-Path $RepoRoot "companion-desktop\$outRootName\installer\win-unpacked\resources\local-companion-bundle\maya-plugins\script-hub-bridge\script_hub_bridge.py"
  if (-not (Test-Path -LiteralPath $alt)) {
    throw "Pack missing Maya bridge py at expected win-unpacked path: $unpackedBridge"
  }
}
Write-Host '[release-pack] Maya bridge resource present in unpacked bundle.' -ForegroundColor DarkCyan

# --- shell tool ZIPs ---
$packScript = Join-Path $RepoRoot 'scripts\pack-shell-tool.mjs'
$shellArgs = @('--yes', '-p', 'tsx', 'tsx', $packScript)
if (-not [string]::IsNullOrWhiteSpace($ShellTools)) {
  foreach ($name in ($ShellTools -split '[,;\s]+' | Where-Object { $_ })) {
    Write-Host "[release-pack] Packing shell tool: $name" -ForegroundColor Cyan
    & npx.cmd @($shellArgs + @($name))
    if ($LASTEXITCODE -ne 0) { throw "pack:shell-tool failed for $name" }
  }
}
else {
  Write-Host '[release-pack] Packing all packages/shell-tools/*' -ForegroundColor Cyan
  & npx.cmd @shellArgs
  if ($LASTEXITCODE -ne 0) { throw 'pack:shell-tool failed' }
}

# --- checksums ---
$installerDir = Join-Path $RepoRoot "companion-desktop\$outRootName\installer"
if (Test-Path -LiteralPath $installerDir) {
  $codexCleanMachinePs1 = Join-Path $RepoRoot 'scripts\verify-codex-clean-machine.ps1'
  if (Test-Path -LiteralPath $codexCleanMachinePs1) {
    Copy-Item -LiteralPath $codexCleanMachinePs1 -Destination (Join-Path $installerDir 'verify-codex-clean-machine.ps1') -Force
    Write-Host "[release-pack] Copied verify-codex-clean-machine.ps1 to $installerDir" -ForegroundColor DarkCyan
  }
  $latestInstaller = Get-ChildItem -LiteralPath $installerDir -File -Filter "AssetCutterCompanion-$cur-*-x64.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  $acceptancePs1 = Join-Path $installerDir 'verify-codex-clean-machine.ps1'
  if ($latestInstaller -and (Test-Path -LiteralPath $acceptancePs1)) {
    $readmePath = Join-Path $installerDir 'README-clean-machine.txt'
    $readmeLines = @(
      'AssetCutter Codex clean-machine acceptance',
      '',
      'Use this package on a fresh Windows PC to prove one-click Codex setup works end to end.',
      '',
      '1. Unzip AssetCutterCompanion-*-clean-machine-acceptance.zip.',
      '2. Run this command in PowerShell from the unzipped folder:',
      '   powershell -ExecutionPolicy Bypass -File .\verify-codex-clean-machine.ps1 -LaunchInstaller -AutoCodexSetup -Strict -Cookie <logged-in-cookie>',
      '3. Wait until the script writes codex-clean-machine-report-*.json.',
      '4. Send that report back to the release finalizer.',
      '',
      'Success requires cloudIdentitySynced=true and conversationVerified=true.'
    )
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($readmePath, $readmeLines, $utf8)
    Write-Host "[release-pack] Wrote clean-machine README: $readmePath" -ForegroundColor DarkCyan
    $zipName = "AssetCutterCompanion-$cur-clean-machine-acceptance.zip"
    $zipPath = Join-Path $installerDir $zipName
    $stageDir = Join-Path $installerDir 'clean-machine-acceptance'
    if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
    Copy-Item -LiteralPath $latestInstaller.FullName -Destination (Join-Path $stageDir $latestInstaller.Name) -Force
    Copy-Item -LiteralPath $acceptancePs1 -Destination (Join-Path $stageDir 'verify-codex-clean-machine.ps1') -Force
    Copy-Item -LiteralPath $readmePath -Destination (Join-Path $stageDir 'README-clean-machine.txt') -Force
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    $stageFiles = @(Get-ChildItem -LiteralPath $stageDir -File | Select-Object -ExpandProperty FullName)
    if ($stageFiles.Count -lt 3) { throw "Clean-machine acceptance staging incomplete: $stageDir" }
    Compress-Archive -LiteralPath $stageFiles -DestinationPath $zipPath -Force
    Remove-Item -LiteralPath $stageDir -Recurse -Force
    Write-Host "[release-pack] Wrote clean-machine acceptance ZIP: $zipPath" -ForegroundColor DarkCyan
  }
  $exeNames = @(Get-ChildItem -LiteralPath $installerDir -File -Filter 'AssetCutterCompanion-*.exe' |
      Select-Object -ExpandProperty Name)
  $blockNames = @(Get-ChildItem -LiteralPath $installerDir -File -Filter 'AssetCutterCompanion-*.exe.blockmap' |
      Select-Object -ExpandProperty Name)
  $acceptanceNames = @(Get-ChildItem -LiteralPath $installerDir -File -Filter 'verify-codex-clean-machine.ps1' |
      Select-Object -ExpandProperty Name)
  $acceptanceZipNames = @(Get-ChildItem -LiteralPath $installerDir -File -Filter 'AssetCutterCompanion-*-clean-machine-acceptance.zip' |
      Select-Object -ExpandProperty Name)
  $acceptanceReadmeNames = @(Get-ChildItem -LiteralPath $installerDir -File -Filter 'README-clean-machine.txt' |
      Select-Object -ExpandProperty Name)
  Write-Sha256Sums -Dir $installerDir -Names ($exeNames + $blockNames + $acceptanceNames + $acceptanceZipNames + $acceptanceReadmeNames)
}

$shellOut = Join-Path $RepoRoot 'dist-out-shell-tools'
if (Test-Path -LiteralPath $shellOut) {
  $zips = @(Get-ChildItem -LiteralPath $shellOut -File -Filter '*.zip' | Select-Object -ExpandProperty Name)
  Write-Sha256Sums -Dir $shellOut -Names $zips
}

Write-Host ''
Write-Host '========== RELEASE PACK READY ==========' -ForegroundColor Green
Write-Host "companion version : $cur"
Write-Host "desktop installer : companion-desktop\$outRootName\installer\"
Write-Host 'shell tool zips   : dist-out-shell-tools\'
Write-Host 'Admin upload:'
Write-Host "  desktop_shell      semver=$cur  platform=win32  (+ .blockmap)"
Write-Host '  shell_tool_bundle  notes: #toolId:<id> #tags:...'
Write-Host '========================================'

if (-not $SkipRestart) {
  Write-Host '[release-pack] Restarting local companion...' -ForegroundColor DarkCyan
  & (Join-Path $PSScriptRoot 'restart-local-companion.ps1')
}
else {
  Write-Host '[release-pack] SkipRestart: companion left stopped.' -ForegroundColor Yellow
}
