"""Prove that tests/login.ts logs each test account in (F2). No secret is ever printed.

Usage:
  python check_login.py --all                       every account in .env.example
  python check_login.py --account EMPLOYEE_TEST_ACCOUNT [--account ...]
  python check_login.py --run runs/<run-id>         the accounts the run's cases name
  add --fresh to ignore saved sessions and log in again

For each account it runs tests/login.check.spec.ts once with UAT_LOGIN_AS=<account>; the loginAs
fixture logs in through tests/login.ts and expectLoggedIn() must pass. Output per account: OK or
FAIL with the first error line. Any value from .env that appears in the error is replaced by ***.
Exit 0 = every account logged in, 1 = at least one did not, 2 = nothing to check or not set up.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import account_key  # noqa: E402


def accounts_in_example():
    example = ROOT / ".env.example"
    return re.findall(r"^([A-Z0-9_]+)_USER=", example.read_text(encoding="utf-8"), re.M) if example.exists() else []


def env_values():
    """Account values (.env and the environment), used only to scrub them from output. Never printed or returned."""
    values = []
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*[A-Z0-9_]+\s*=\s*(.+?)\s*$", line)
            if m:
                v = m.group(1).strip('"').strip("'")
                if len(v) >= 3 and not v.startswith("http"):
                    values.append(v)
    # A host such as UAT Studio passes the accounts as environment variables instead of a .env file.
    values += [v for k, v in os.environ.items() if k.endswith(("_USER", "_PASSWORD")) and len(v) >= 3]
    return values


def scrub(text, secrets):
    for s in sorted(secrets, key=len, reverse=True):
        text = text.replace(s, "***")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--account", action="append", default=[])
    parser.add_argument("--run")
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()

    accounts = list(args.account)
    if args.all:
        accounts += accounts_in_example()
    if args.run:
        run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run
        cases = json.loads((run / "cases.json").read_text(encoding="utf-8"))
        accounts += [account_key(c["login_as"]) for c in cases if c.get("login_as")]
    accounts = list(dict.fromkeys(a for a in accounts if a))
    if not accounts:
        print("No account to check (no 'Login as' in the cases, nothing in .env.example).")
        return 2
    login_ts = ROOT / "tests" / "login.ts"
    if not login_ts.exists() or "write login() for your app" in login_ts.read_text(encoding="utf-8"):
        print("tests/login.ts does not know how to log in yet: run /setup-login first.")
        return 2

    secrets = env_values()
    scratch = Path(tempfile.mkdtemp(prefix="uat-login-check-"))
    failed = 0
    try:
        for account in accounts:
            run_dir = scratch / account
            if args.fresh:
                shutil.rmtree(run_dir, ignore_errors=True)
            env = dict(os.environ, UAT_LOGIN_AS=account, UAT_RUN_DIR=str(run_dir), UAT_PROGRESS="0",
                       UAT_SHOTS="0", UAT_CONSOLE="0", UAT_VIDEO="0")
            cmd = ["npx", "playwright", "test", "tests/login.check.spec.ts", "--reporter=line", "--trace", "off"]
            r = subprocess.run(cmd, cwd=ROOT, env=env, shell=(os.name == "nt"), capture_output=True, text=True)
            if r.returncode == 0:
                print(f"OK       {account}")
                continue
            failed += 1
            out = scrub(r.stdout + "\n" + r.stderr, secrets)
            lines = [l.strip() for l in out.splitlines() if l.strip()]
            error = next((l for l in lines if l.startswith("Error") or "Error:" in l or "expect(" in l), lines[-1] if lines else "no output")
            print(f"FAIL     {account}: {error[:200]}")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)       # the saved sessions of the check are not kept
    print(f"{len(accounts) - failed} of {len(accounts)} account(s) logged in.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
