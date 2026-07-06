# Full local dev: kill occupied ports + electron, then vite/auth/sam/gemini + companion-desktop
# Usage: powershell -File scripts/restart-full-local-dev.ps1

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host '[full-restart] Stopping electron / desktop shell...'
Get-Process electron, AssetCutterCompanion -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# Renderbus Raysync 常占用 127.0.0.1:3000/3001（Bound），导致 Vite 退到 3002
Get-Process Raysync-engine -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$ports = @(18081, 9100, 18765, 3000, 3001, 3002, 9002, 8008, 18082)
foreach ($port in $ports) {
  $pids = @(
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
  foreach ($procId in $pids) {
    if ($procId -gt 0) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "[full-restart] Stopped PID $procId (port $port)"
    }
  }
}

Start-Sleep -Seconds 2
Write-Host '[full-restart] Starting vite:3000 auth:9100 sam:18081 gemini:9002 + companion-desktop (spawns 18765)'
Write-Host '[full-restart] Ctrl+C stops all'

npx concurrently -n vite,auth,sam,gemini,desktop -c blue,magenta,cyan,yellow,green `
  'npm run dev' `
  'npm run dev:auth-backend' `
  'npm run dev:sam-local' `
  'npm run dev:gemini-proxy' `
  'npm run companion-desktop:start'
