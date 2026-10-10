"""The bridge to the kit: run its scripts, read its files, use its feature map.

The kit's scripts stay the single source of truth for every deterministic step. The app never
re-implements them; it runs them exactly as the agents in VS Code would, and shows their output.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import yaml

from .settings import KIT_DIR

PY = sys.executable
SCRIPTS = {
    "progress": "scripts/progress.py",
    "run_tests": "scripts/run_tests.py",
    "features": "scripts/features.py",
    "selftest": "scripts/selftest.py",
    "guard": "scripts/guard_hook.py",
    "read_excel": ".github/skills/reading-uat-excel/scripts/read_excel.py",
    "validate": ".github/skills/reading-uat-excel/scripts/validate.py",
    "diff_cases": ".github/skills/detecting-test-changes/scripts/diff_cases.py",
    "excel_to_plan": ".github/skills/writing-playwright-plan/scripts/excel_to_plan.py",
    "merge_app_map": ".github/skills/mapping-the-app/scripts/merge_app_map.py",
    "check_tests": ".github/skills/checking-generated-tests/scripts/check_tests.py",
    "repeat_new_tests": ".github/skills/checking-flakiness/scripts/repeat_new_tests.py",
    "filter_console": ".github/skills/analyzing-console-errors/scripts/filter_console.py",
    "record_diagnosis": ".github/skills/diagnosing-failures/scripts/record_diagnosis.py",
    "reproduce": ".github/skills/reproducing-failures/scripts/reproduce.py",
    "compare_screens": ".github/skills/comparing-screens/scripts/compare_screens.py",
    "verify_evidence": ".github/skills/verifying-evidence/scripts/verify_evidence.py",
    "record_decision": ".github/skills/writing-results-excel/scripts/record_decision.py",
    "write_results": ".github/skills/writing-results-excel/scripts/write_results.py",
    "usage_report": ".github/skills/tracking-usage/scripts/usage_report.py",
    "check_setup": ".github/skills/checking-setup/scripts/check_setup.py",
    "check_login": ".github/skills/setting-up-login/scripts/check_login.py",
    "make_template": "templates/make_template.py",
}
# Commands the Setup page may run after the person says yes (the setup agent's fixes). Nothing else.
FIX_COMMANDS = {
    "npm-install": ["npm", "install"],
    "playwright-chromium": ["npx", "playwright", "install", "chromium"],
    "pip-install": [PY, "-m", "pip", "install", "-r", "requirements.txt"],
    "init-agents": ["npx", "playwright", "init-agents", "--loop=vscode"],
}


@dataclass
class ScriptResult:
    code: int
    output: str
    command: str


def _popen_kwargs():
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    return dict(cwd=KIT_DIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", shell=(os.name == "nt"))


def _run_blocking(cmd: list[str], timeout: float | None, on_line: Callable[[str], None] | None) -> ScriptResult:
    kwargs = _popen_kwargs()
    if os.name == "nt":
        cmd_str = subprocess.list2cmdline(cmd)
        proc = subprocess.Popen(cmd_str, **kwargs)
    else:
        kwargs["shell"] = False
        proc = subprocess.Popen(cmd, **kwargs)
    lines = []
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip("\n")
        lines.append(line)
        if on_line:
            on_line(line)
    try:
        code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        code = 124
        lines.append(f"(stopped after {timeout} seconds)")
    return ScriptResult(code, "\n".join(lines), " ".join(cmd))


async def run_script(name: str, *args: str, timeout: float | None = 900,
                     on_line: Callable[[str], None] | None = None) -> ScriptResult:
    """Run one of the kit's Python scripts with the app's Python (same packages)."""
    cmd = [PY, SCRIPTS[name], *[str(a) for a in args]]
    loop = asyncio.get_running_loop()
    if on_line:
        safe = lambda line: loop.call_soon_threadsafe(on_line, line)  # noqa: E731
    else:
        safe = None
    return await asyncio.to_thread(_run_blocking, cmd, timeout, safe)


async def run_command(cmd: list[str], timeout: float | None = 1800,
                      on_line: Callable[[str], None] | None = None) -> ScriptResult:
    loop = asyncio.get_running_loop()
    safe = (lambda line: loop.call_soon_threadsafe(on_line, line)) if on_line else None
    return await asyncio.to_thread(_run_blocking, cmd, timeout, safe)


# ---------------- files ----------------

def runs_dir() -> Path:
    return KIT_DIR / "runs"


def run_path(run_id: str) -> Path:
    p = (runs_dir() / run_id).resolve()
    if p.parent != runs_dir().resolve() or not p.name or p.name == "current":
        raise ValueError(f"Not a run: {run_id}")
    return p


def is_run(p: Path) -> bool:
    return p.is_dir() and p.name != "current" and (p / "progress.json").exists()


def list_runs() -> list[str]:
    if not runs_dir().exists():
        return []
    return sorted((p.name for p in runs_dir().iterdir() if is_run(p)), reverse=True)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def read_yaml(rel: str, default=None):
    try:
        return yaml.safe_load((KIT_DIR / rel).read_text(encoding="utf-8"))
    except OSError:
        return default


def workflow() -> dict:
    return read_yaml("config/workflow.yaml", {"stages": [], "limits": {}})


def safe_kit_path(rel: str) -> Path:
    """A path inside the kit that is not a secret and not a dependency folder."""
    p = (KIT_DIR / rel).resolve()
    if KIT_DIR.resolve() not in p.parents and p != KIT_DIR.resolve():
        raise ValueError("Outside the kit")
    parts = {x.lower() for x in p.relative_to(KIT_DIR.resolve()).parts}
    if p.name.lower() == ".env" or "node_modules" in parts or ".git" in parts:
        raise ValueError("Not readable")
    return p


# ---------------- feature switches (the kit's own module) ----------------

def features_module():
    """Import scripts/features.py fresh, so profile changes are always seen."""
    scripts = str(KIT_DIR / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import features  # type: ignore
    importlib.reload(features)
    return features


def is_on(feature_id: str) -> bool:
    f = features_module()
    items = f.load_items()
    return feature_id not in items or feature_id in f.effective_on(items, f.load_off())


def guardrails() -> dict:
    return read_yaml("config/guardrails.yaml", {}) or {}


def env_example_accounts() -> list[str]:
    import re
    p = KIT_DIR / ".env.example"
    if not p.exists():
        return []
    return re.findall(r"^([A-Z0-9_]+)_USER=", p.read_text(encoding="utf-8"), re.M)


def env_values() -> dict[str, str]:
    """The private .env file as a dict. Only the app reads it; agents never see these values."""
    import re
    out = {}
    p = KIT_DIR / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                out[m.group(1)] = m.group(2).strip('"').strip("'")
    return out


def account_key(name: str) -> str:
    """'Employee test account' -> 'EMPLOYEE_TEST_ACCOUNT' (same rule as the kit's scripts/common.py)."""
    import re
    return re.sub(r"[^A-Z0-9]+", "_", str(name or "").upper()).strip("_")


def latest_cases() -> tuple[str, list[dict]]:
    """The newest test cases Studio has read: from the newest run, else the Excel given to login setup."""
    for run_id in list_runs():
        cases = read_json(runs_dir() / run_id / "cases.json")
        if cases:
            return f"run {run_id}", cases
    cases = read_json(runs_dir() / "setup" / "cases.json")
    return ("the Excel given to login setup", cases) if cases else ("", [])


def accounts_overview(cases: list[dict]) -> list[dict]:
    """Every test account Studio knows of: entered on the Setup page or named in the cases' "Login as".
    Says whether its values are filled in (never the values) and which cases use it."""
    values = env_values()
    used: dict[str, list[str]] = {}
    for c in cases:
        if c.get("login_as"):
            used.setdefault(account_key(c["login_as"]), []).append(c.get("test_id", "?"))
    names = list(dict.fromkeys([*env_example_accounts(), *(k[:-5] for k in values if k.endswith("_USER")), *used]))
    return [{"name": n, "user_set": bool(values.get(f"{n}_USER")), "password_set": bool(values.get(f"{n}_PASSWORD")),
             "used_by": used.get(n, [])} for n in names]
