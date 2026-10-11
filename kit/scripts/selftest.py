"""Run the kit's self-tests: every Python script is exercised on a throw-away copy of the kit.

Usage: python scripts/selftest.py [pytest options]
Needs pytest (pip install -r requirements.txt). No browser, Node.js or app under test is needed.
Exit code is pytest's (0 = everything passed).
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    try:
        import pytest  # noqa: F401
    except ImportError:
        print("pytest is not installed: pip install -r requirements.txt")
        sys.exit(2)
    sys.exit(subprocess.run([sys.executable, "-m", "pytest", "selftest", "-q", *sys.argv[1:]], cwd=ROOT).returncode)
