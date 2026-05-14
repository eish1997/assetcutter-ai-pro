# Stop listeners on dev ports, then start: Vite + auth-api + local-companion + SamLocal + gemini-proxy
# Usage: npm run restart:local-stack
# 生图（试用/Vertex 走 bulk）：前端建议 .env.local 设 VITE_BULK_IMAGE_API=same-origin，由 Vite 反代 /proxy/gemini → 本机 9002。

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$ports = @(18081, 9100, 18765, 3000, 9002)
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
Write-Host "[restart-local-stack] Starting vite:3000 auth:9100 companion:18765 sam:18081 gemini:9002 (Ctrl+C stops all)"
npx concurrently -n vite,auth,companion,sam,gemini -c blue,magenta,green,cyan,yellow 'npm run dev' 'npm run dev:auth-backend' 'npm run local-companion:dev' 'npm run dev:sam-local' 'npm run dev:gemini-proxy'
