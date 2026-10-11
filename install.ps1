# UAT Studio: everything a new Windows machine needs, in one go. Run from this folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# Needs Python 3.11+ and Node.js 20.12+. Safe to run again: it only adds what is missing.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Step($text) { Write-Host "`n== $text" -ForegroundColor Yellow }
function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Missing: $cmd. $hint" -ForegroundColor Red; exit 1 }
}

Step 'Checking Python and Node.js'
Need 'python' 'Install Python 3.11 or newer from https://www.python.org/downloads/ (tick "Add to PATH").'
Need 'node' 'Install Node.js 20.12 or newer from https://nodejs.org/.'
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
if ($LASTEXITCODE -ne 0) { Write-Host 'Python 3.11 or newer is needed.' -ForegroundColor Red; exit 1 }

# The kit: a kit folder next to uat-studio if there is one (an existing setup), else the one in this repository.
$kit = if ($env:UAT_KIT_DIR) { $env:UAT_KIT_DIR } elseif (Test-Path (Join-Path $root '..\agentic-testing-kit\config\workflow.yaml')) { Join-Path $root '..\agentic-testing-kit' } else { Join-Path $root 'kit' }

Step 'Back end (Python packages)'
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { python -m venv (Join-Path $root 'backend\.venv') }
& $py -m pip install --upgrade pip --quiet
Push-Location (Join-Path $root 'backend'); & $py -m pip install -r requirements.txt --quiet; Pop-Location

Step 'Front end (build)'
Push-Location (Join-Path $root 'frontend'); npm.cmd install --no-fund --no-audit; npm.cmd run build; Pop-Location

Step "The kit ($kit): Playwright and Chromium"
Push-Location $kit; npm.cmd install --no-fund --no-audit; npx.cmd playwright install chromium; Pop-Location

Step 'Done'
Write-Host "Start UAT Studio with:" -ForegroundColor Green
Write-Host "  cd `"$root\backend`"; .venv\Scripts\python -m app"
Write-Host "Then open http://127.0.0.1:8765 and follow Set up."
