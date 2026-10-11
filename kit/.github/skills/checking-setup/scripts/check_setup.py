"""Check everything the UAT flow needs. Prints one line per requirement: OK, MISSING, BROKEN or WARN,
with the command or action that fixes it. Never prints secret values.

Usage: python check_setup.py [--run runs/<run-id>]
With --run it also checks the test accounts and start pages named in that run's cases.json.
Exit 0 = everything required is OK, 1 = something required is MISSING or BROKEN.
"""
import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import origin_allowed  # noqa: E402
lines, failed = [], False


def report(status, item, fix=""):
    global failed
    failed |= status in ("MISSING", "BROKEN")
    lines.append(f"{status:<8} {item}" + (f"  -> {fix}" if fix else ""))


def read_env(path):
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                env[m.group(1)] = m.group(2).strip('"').strip("'")
    return env


def account_key(name):
    return re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")


def browsers_dir():
    if os.environ.get("PLAYWRIGHT_BROWSERS_PATH") not in (None, "", "0"):
        return Path(os.environ["PLAYWRIGHT_BROWSERS_PATH"])
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright"
    return Path.home() / ".cache" / "ms-playwright"


def reachable(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=10) as r:
            return r.status < 500, f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        return e.code < 500, f"HTTP {e.code}"
    except Exception as e:                                    # noqa: BLE001 - any network error means not reachable
        return False, type(e).__name__


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run")
    args = parser.parse_args()

    # Node.js and Playwright
    try:
        out = subprocess.run(["node", "--version"], capture_output=True, text=True, shell=(os.name == "nt")).stdout.strip()
        major, minor = (int(x) for x in re.match(r"v(\d+)\.(\d+)", out).groups())
        ok = (major, minor) >= (20, 12)                       # process.loadEnvFile (playwright.config.ts) needs 20.12+
        report("OK" if ok else "BROKEN", f"Node.js {out}", "" if ok else "install Node.js 20.12 or newer from https://nodejs.org")
    except Exception:                                         # noqa: BLE001
        report("MISSING", "Node.js", "install Node.js 20.12+ from https://nodejs.org")
    pkg = ROOT / "node_modules" / "@playwright" / "test" / "package.json"
    if pkg.exists():
        report("OK", f"Playwright {json.loads(pkg.read_text(encoding='utf-8'))['version']}")
    else:
        report("MISSING", "Playwright (@playwright/test)", "npm install")
    bdir = browsers_dir()
    if bdir.exists() and any(p.name.startswith("chromium") for p in bdir.iterdir()):
        report("OK", "Playwright Chromium browser")
    else:
        report("MISSING", "Playwright Chromium browser", "npx playwright install chromium")

    # Python
    v = sys.version_info
    report("OK" if v >= (3, 10) else "BROKEN", f"Python {v.major}.{v.minor}", "" if v >= (3, 10) else "install Python 3.10+")
    for module, package in (("openpyxl", "openpyxl"), ("yaml", "pyyaml")):
        found = importlib.util.find_spec(module) is not None
        report("OK" if found else "MISSING", f"Python package {package}", "" if found else "pip install -r requirements.txt")
    if importlib.util.find_spec("PIL") is None:
        report("WARN", "Python package pillow (needed only for screen comparison)", "pip install -r requirements.txt")
    else:
        report("OK", "Python package pillow")

    # VS Code pieces
    mcp = ROOT / ".vscode" / "mcp.json"
    has_server = mcp.exists() and "playwright-test" in json.loads(mcp.read_text(encoding="utf-8")).get("servers", {})
    report("OK" if has_server else "MISSING", "Playwright test MCP server in .vscode/mcp.json",
           "" if has_server else "npx playwright init-agents --loop=vscode")
    agents = [ROOT / ".github" / "agents" / f"playwright-test-{a}.agent.md" for a in ("planner", "generator", "healer")]
    missing = [a.name for a in agents if not a.exists()]
    report("OK" if not missing else "MISSING", "Playwright agents (planner, generator, healer)" + (f": {', '.join(missing)}" if missing else ""),
           "" if not missing else "npx playwright init-agents --loop=vscode")
    hook = ROOT / ".github" / "hooks" / "guard.json"
    ok = hook.exists() and "guard_hook.py" in hook.read_text(encoding="utf-8") and (ROOT / "scripts" / "guard_hook.py").exists()
    report("OK" if ok else "BROKEN", "Guard hook (.github/hooks/guard.json -> scripts/guard_hook.py)",
           "" if ok else "restore the hook files from the repository")

    # Test environment
    env_file = ROOT / ".env"
    env = read_env(env_file)
    if not env_file.exists():
        report("MISSING", ".env", "copy .env.example to .env and fill in the values")
    start = env.get("START_PAGE") or os.environ.get("START_PAGE", "")
    if not start:
        report("MISSING", ".env: START_PAGE", "set the address of the app under test")
    allowed = yaml.safe_load((ROOT / "config" / "guardrails.yaml").read_text(encoding="utf-8"))["allowed_origins"]

    accounts, pages = set(), {start} if start else set()
    if args.run:
        cases = json.loads((ROOT / args.run / "cases.json").read_text(encoding="utf-8"))
        accounts = {account_key(c["login_as"]) for c in cases if c.get("login_as")}
        pages |= {c["start_page"] for c in cases if c.get("start_page")}
    for acc in sorted(accounts):
        for part in ("USER", "PASSWORD"):
            key = f"{acc}_{part}"
            report("OK" if env.get(key) else "MISSING", f".env: {key}", "" if env.get(key) else "fill it in .env (never in the Excel)")
    if accounts:
        login_ts = (ROOT / "tests" / "login.ts").read_text(encoding="utf-8") if (ROOT / "tests" / "login.ts").exists() else ""
        written = login_ts and "write login() for your app" not in login_ts
        report("OK" if written else "MISSING", "tests/login.ts knows how to log in (cases name a test account)",
               "" if written else "run /setup-login once for this app")
        lines.append("INFO     Then prove each account logs in: python .github/skills/setting-up-login/scripts/check_login.py"
                     + (f" --run {args.run}" if args.run else ""))

    origins = {}
    for page in sorted(pages):
        p = urlparse(page)
        origins.setdefault(f"{p.scheme}://{p.netloc}", page)
    for origin, page in origins.items():
        if not origin_allowed(origin, allowed):
            report("BROKEN", f"{origin} is not in config/guardrails.yaml allowed_origins", "add it, or fix the address")
            continue
        ok, detail = reachable(page)
        report("OK" if ok else "BROKEN", f"Start page reachable: {page} ({detail})", "" if ok else "check the address, VPN or that the app is running")

    # Feature switches: the map and the profile must agree
    sys.path.insert(0, str(ROOT / "scripts"))
    import features
    found = features.problems(features.load_items(), features.load_off())
    report("OK" if not found else "BROKEN", "Feature switches (config/features.yaml, config/profile.yaml)" + (f": {found[0]}" if found else ""),
           "" if not found else "python scripts/features.py check")

    lines.append("INFO     In VS Code: trust this workspace and keep the setting chat.useHooks on (hooks are a Preview feature)")
    print("\n".join(lines))
    print("Result: " + ("something required is missing or broken" if failed else "ready"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
