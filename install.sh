#!/usr/bin/env sh
# UAT Studio: everything a new macOS or Linux machine needs, in one go. Run from this folder:  sh install.sh
# Needs Python 3.11+ and Node.js 20.12+. Safe to run again: it only adds what is missing.
set -e
root=$(cd "$(dirname "$0")" && pwd)
step() { printf '\n== %s\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1. $2"; exit 1; }; }

step "Checking Python and Node.js"
need python3 "Install Python 3.11 or newer from https://www.python.org/downloads/"
need node "Install Node.js 20.12 or newer from https://nodejs.org/"
python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" || { echo "Python 3.11 or newer is needed."; exit 1; }

# The kit: a kit folder next to uat-studio if there is one (an existing setup), else the one in this repository.
if [ -n "$UAT_KIT_DIR" ]; then kit=$UAT_KIT_DIR
elif [ -f "$root/../agentic-testing-kit/config/workflow.yaml" ]; then kit="$root/../agentic-testing-kit"
else kit="$root/kit"; fi

step "Back end (Python packages)"
[ -x "$root/backend/.venv/bin/python" ] || python3 -m venv "$root/backend/.venv"
"$root/backend/.venv/bin/python" -m pip install --upgrade pip --quiet
(cd "$root/backend" && .venv/bin/python -m pip install -r requirements.txt --quiet)

step "Front end (build)"
(cd "$root/frontend" && npm install --no-fund --no-audit && npm run build)

step "The kit ($kit): Playwright and Chromium"
(cd "$kit" && npm install --no-fund --no-audit && npx playwright install chromium)

step "Done"
echo "Start UAT Studio with:"
echo "  cd \"$root/backend\" && .venv/bin/python -m app"
echo "Then open http://127.0.0.1:8765 and follow Set up."
