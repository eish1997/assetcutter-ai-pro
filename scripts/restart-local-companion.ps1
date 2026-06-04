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
npm run companion-desktop:start
