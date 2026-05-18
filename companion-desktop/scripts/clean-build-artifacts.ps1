# 清理 companion-desktop 下可再生的打包产物（dist、dist-out-*、release*、bundle 等）
# 用法：在仓库根 npm run companion-desktop:clean
# 若 app.asar 被占用：先退出托盘伴侣、关闭从 win-unpacked 启动的开发壳，必要时关闭 Cursor 后重试

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')

function Stop-CompanionProcesses {
  taskkill /F /IM AssetCutterCompanion.exe /T 2>$null | Out-Null
  taskkill /F /IM electron.exe /T 2>$null | Out-Null
  Start-Sleep -Seconds 2
}

function Remove-TreeForce([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $true }
  Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $path)) { return $true }

  $empty = Join-Path $env:TEMP "companion-desktop-empty-$(Get-Random)"
  New-Item -ItemType Directory -Force -Path $empty | Out-Null
  robocopy $empty $path /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  Remove-Item -LiteralPath $empty -Force -Recurse -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  return -not (Test-Path -LiteralPath $path)
}

Stop-CompanionProcesses

$names = @(
  'dist',
  'local-companion-bundle',
  'sam-local-bundled',
  'build-constants.json'
)
Get-ChildItem -LiteralPath $root -Directory -Filter 'dist-out-*' -ErrorAction SilentlyContinue |
  ForEach-Object { $names += $_.Name }
Get-ChildItem -LiteralPath $root -Directory -Filter 'release*' -ErrorAction SilentlyContinue |
  ForEach-Object { $names += $_.Name }

$failed = @()
foreach ($name in ($names | Select-Object -Unique)) {
  $p = Join-Path $root $name
  if (-not (Test-Path -LiteralPath $p)) { continue }
  if (Remove-TreeForce $p) {
    Write-Host "[clean] removed $name"
  } else {
    $failed += $name
    Write-Host "[clean] FAILED (file in use?): $name"
  }
}

if ($failed.Count -gt 0) {
  Write-Host ''
  Write-Host '仍有目录被占用（多为 win-unpacked/resources/app.asar）。请完全退出 AssetCutter 伴侣与 Electron 后重新运行：'
  Write-Host '  npm run companion-desktop:clean'
  exit 1
}

Write-Host '[clean] done.'
