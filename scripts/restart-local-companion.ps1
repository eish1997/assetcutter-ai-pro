# 结束桌面壳与 18765 监听后启动 companion-desktop（会 spawn local-companion）
# Usage: npm run restart:local-companion
# 代理：在同一会话内对本脚本使用后台执行，避免阻塞。

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Get-Process electron, AssetCutterCompanion -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*paddleocr-service*server.py*' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "[restart-local-companion] Stopped OCR server PID $($_.ProcessId)"
  }

foreach ($port in @(18765, 18082)) {
  $pids = @(
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
  foreach ($procId in $pids) {
    if ($procId -gt 0) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "[restart-local-companion] Stopped PID $procId (port $port)"
    }
  }
}

Start-Sleep -Milliseconds 500
Write-Host "[restart-local-companion] Starting companion-desktop (spawns local-companion child)..."
$logDir = Join-Path $env:TEMP 'assetcutter-companion'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'restart-local-companion.out.log'
$errLog = Join-Path $logDir 'restart-local-companion.err.log'

$child = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'companion-desktop:start') `
  -WorkingDirectory $repo `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Write-Host "[restart-local-companion] Started desktop launcher PID $($child.Id)"

$deadline = (Get-Date).AddSeconds(30)
$healthOk = $false
$electronOk = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:18765/v1/health' -TimeoutSec 2
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
      $healthOk = $true
      break
    }
  } catch {
    # Keep waiting; Electron may still be starting the local companion child.
  }
  $electronOk = [bool](Get-Process electron -ErrorAction SilentlyContinue)
  if ($electronOk) {
    Start-Sleep -Milliseconds 600
  } else {
    Start-Sleep -Milliseconds 300
  }
}

if ($healthOk) {
  Write-Host "[restart-local-companion] Local companion health is ready."
  exit 0
}

$electronOk = [bool](Get-Process electron -ErrorAction SilentlyContinue)
if ($electronOk) {
  Write-Host "[restart-local-companion] Electron is running; local companion health is not ready yet. Logs: $outLog / $errLog"
  exit 0
}

Write-Host "[restart-local-companion] Failed to observe Electron or local companion health. Logs: $outLog / $errLog"
exit 1
