# Stop listeners on dev ports, then start: Vite + auth-api + SamLocal + ai-worker-proxy + Electron desktop (spawns 18765)
# Usage: npm run restart:local-stack
# 生图默认与线上一致（.env.development → Render ai-worker-proxy + Vite 转发）。仅调试本机 9002 时在 .env.local 覆盖为 same-origin。
# 不要并行 local-companion:dev：桌面壳会 spawn 宿主，双开会抢 18765。

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Get-Process electron, AssetCutterCompanion -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$ports = @(18081, 9100, 18765, 3000, 9002, 18082, 3080, 3081)
foreach ($port in $ports) {
  $pids = @(
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
  foreach ($procId in $pids) {
    if ($procId -gt 0) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "[restart-local-stack] Stopped PID $procId (port $port)"
    }
  }
}

Start-Sleep -Seconds 2
Write-Host "[restart-local-stack] Starting vite:3000 auth:9100 sam:18081 gemini:9002 + companion-desktop (spawns 18765) (Ctrl+C stops all)"
npx concurrently -n vite,auth,sam,gemini,desktop -c blue,magenta,cyan,yellow,green `
  'npm run dev' `
  'npm run dev:auth-backend' `
  'npm run dev:sam-local' `
  'npm run dev:ai-worker-proxy' `
  'npm run companion-desktop:start'
