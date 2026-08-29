# start-dev.ps1 — Boots the full RentBuddy dev stack:
#   1. PostgreSQL (required by backend)
#   2. Backend API  (:5000)
#   3. Web client   (:5173)
#
# Run from the rent-01 repo root:
#   powershell -ExecutionPolicy Bypass -File start-dev.ps1

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BrowserDir  = Join-Path $Root "packages\web"
$BackendDir  = Join-Path $Root "packages\backend"
$PgService  = "postgresql-x64-17"
$LogDir     = $Root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
# 1. PostgreSQL
# ---------------------------------------------------------------------------
Write-Step "Ensuring PostgreSQL is running ($PgService)"
$pgUp = $false
try {
  $svc = Get-Service -Name $PgService -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq "Running") {
    Write-Host "  PostgreSQL already running."
    $pgUp = $true
  } else {
    Write-Host "  Starting $PgService..."
    try {
      Start-Service -Name $PgService -ErrorAction Stop
      $pgUp = $true
    } catch {
      # Not enough privilege — retry elevated (UAC prompt may appear)
      Write-Host "  Privilege required, retrying as administrator..."
      Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -Command Start-Service $PgService; exit" -Wait -ErrorAction Stop
      $pgUp = $true
    }
  }
} catch {
  Write-Host "  ERROR starting PostgreSQL: $_" -ForegroundColor Red
}

if ($pgUp) {
  # Wait for the port to accept connections (max ~30s)
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $c = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 5432)
      $c.Close(); $ready = $true; break
    } catch { Start-Sleep -Seconds 1 }
  }
  if ($ready) { Write-Host "  PostgreSQL is accepting connections on :5432." -ForegroundColor Green }
  else { Write-Host "  WARNING: PostgreSQL did not come up in time. Backend may fail." -ForegroundColor Yellow }
} else {
  Write-Host "  PostgreSQL could not be started. Aborting." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------------------
# 2. Backend
# ---------------------------------------------------------------------------
Write-Step "Starting backend (packages/backend) -> http://localhost:5000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$BackendDir'; npm run dev *> '$LogDir\backend.log'" -WindowStyle Minimized

# Give the backend a moment to bind
Start-Sleep -Seconds 6
$backendUp = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:5000/health" -TimeoutSec 2
    if ($r.success -or $r.status) { $backendUp = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if ($backendUp) { Write-Host "  Backend is up (http://localhost:5000/health OK)." -ForegroundColor Green }
else { Write-Host "  WARNING: backend not responding yet. Check $LogDir\backend.log" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# 3. Web
# ---------------------------------------------------------------------------
Write-Step "Starting web (packages/web) -> http://localhost:5173"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$BrowserDir'; npm run dev *> '$LogDir\web.log'" -WindowStyle Minimized

Start-Sleep -Seconds 6
Write-Host "`n==> Dev stack launch complete." -ForegroundColor Green
Write-Host "    Backend : http://localhost:5000"
Write-Host "    Web     : http://localhost:5173"
Write-Host "    Logs    : $LogDir\backend.log, $LogDir\web.log"
Write-Host ""
Write-Host "Servers run in their own windows and will keep running after this script exits." -ForegroundColor Gray
# Exit cleanly (no blocking prompt) so the launcher does not get stuck if
# invoked non-interactively; child servers continue independently.
Start-Sleep -Seconds 2
exit 0
