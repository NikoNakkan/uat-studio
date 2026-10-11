"""The bridge to the kit: run its scripts, read its files, use its feature map.

The kit's scripts stay the single source of truth for every deterministic step. The app never
re-implements them; it runs them exactly as the agents in VS Code would, and shows their output.
"""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import json
import os
import signal
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import yaml

from . import projects


def kit_dir() -> Path:
    """The kit folder of the current project (see projects.py)."""
    return projects.current_dir()


def __getattr__(name: str):
    # kit.KIT_DIR is read at the moment it is used, so it is always the current request's (or run's) project.
    if name == "KIT_DIR":
        return kit_dir()
    raise AttributeError(name)

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


# Commands belong to whoever started them (a run id, or "app" for setup), so Stop can end the
# process tree. Cancelling the asyncio task does not: the command runs in a thread, and on Windows
# the handle we hold is only the shell, not npx or the browser under it.
_owner: contextvars.ContextVar[str] = contextvars.ContextVar("uat_script_owner", default="")
_owned: dict[str, set[subprocess.Popen]] = {}
_stop_gen: dict[str, int] = {}
_owned_lock = threading.Lock()


def _owner_key(name: str) -> str:
    """Owners are per project: "app" (setup work) exists in every project, and Stop must end only its own."""
    return f"{projects.current_id()}|{name}"


def push_script_owner(name: str):
    return _owner.set(_owner_key(name))


def pop_script_owner(token) -> None:
    _owner.reset(token)


@contextlib.contextmanager
def script_owner(name: str):
    """Commands this task starts belong to `name` until the block ends."""
    token = push_script_owner(name)
    try:
        yield
    finally:
        pop_script_owner(token)


def _generation(owner: str) -> int:
    with _owned_lock:
        return _stop_gen.get(owner, 0)


def _track(proc: subprocess.Popen) -> None:
    owner = _owner.get()
    if not owner:
        return
    with _owned_lock:
        _owned.setdefault(owner, set()).add(proc)


def _untrack(proc: subprocess.Popen) -> None:
    owner = _owner.get()
    if not owner:
        return
    with _owned_lock:
        bucket = _owned.get(owner)
        if not bucket:
            return
        bucket.discard(proc)
        if not bucket:
            _owned.pop(owner, None)


def kill_owned(owner: str) -> int:
    """End every command started for this owner, including children. Returns how many were alive."""
    owner = _owner_key(owner)
    with _owned_lock:
        _stop_gen[owner] = _stop_gen.get(owner, 0) + 1
        procs = list(_owned.get(owner, ()))
    return sum(1 for proc in procs if _kill_tree(proc))


def _kill_tree(proc: subprocess.Popen) -> bool:
    if proc.poll() is not None:
        return False
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                proc.kill()
            except OSError:
                return False
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
            proc.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            pass
    return True


def _popen_kwargs():
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    kw = dict(cwd=kit_dir(), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
              text=True, encoding="utf-8", errors="replace", shell=(os.name == "nt"))
    if os.name == "nt":
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    return kw


def _run_blocking(cmd: list[str], timeout: float | None, on_line: Callable[[str], None] | None) -> ScriptResult:
    kwargs = _popen_kwargs()
    owner = _owner.get()
    seen = _generation(owner) if owner else 0
    if os.name == "nt":
        cmd_str = subprocess.list2cmdline(cmd)
        proc = subprocess.Popen(cmd_str, **kwargs)
    else:
        kwargs["shell"] = False
        proc = subprocess.Popen(cmd, **kwargs)
    _track(proc)
    try:
        if owner and _generation(owner) != seen:
            _kill_tree(proc)
            return ScriptResult(130, "(stopped)", " ".join(cmd))
        lines: list[str] = []
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                line = line.rstrip("\n")
                lines.append(line)
                if on_line:
                    on_line(line)
        except OSError:
            pass
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
            code = 124
            lines.append(f"(stopped after {timeout} seconds)")
        return ScriptResult(code, "\n".join(lines), " ".join(cmd))
    finally:
        _untrack(proc)


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
    return kit_dir() / "runs"


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
        return yaml.safe_load((kit_dir() / rel).read_text(encoding="utf-8"))
    except OSError:
        return default


def workflow() -> dict:
    return read_yaml("config/workflow.yaml", {"stages": [], "limits": {}})


def safe_kit_path(rel: str) -> Path:
    """A path inside the kit that is not a secret and not a dependency folder."""
    p = (kit_dir() / rel).resolve()
    if kit_dir().resolve() not in p.parents and p != kit_dir().resolve():
        raise ValueError("Outside the kit")
    parts = {x.lower() for x in p.relative_to(kit_dir().resolve()).parts}
    if p.name.lower() == ".env" or "node_modules" in parts or ".git" in parts:
        raise ValueError("Not readable")
    return p


# ---------------- feature switches (the kit's own module) ----------------

def features_module():
    """The current project's scripts/features.py, loaded fresh so profile changes are always seen. Loaded by
    file path, not by module name: with several projects, "import features" would keep the first one's."""
    import importlib.util
    path = kit_dir() / "scripts" / "features.py"
    spec = importlib.util.spec_from_file_location(f"uat_features_{abs(hash(str(path)))}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_switches: dict = {}          # kit folder -> {"key": (mtimes), "ids": set, "on": set}


def _mtime(rel: str) -> float:
    try:
        return (kit_dir() / rel).stat().st_mtime
    except OSError:
        return 0.0


def is_on(feature_id: str) -> bool:
    """Whether a part is switched on. Parsing the feature map took about 0.45 s, and a run page asked once per
    stage on every refresh (5 s per refresh, queuing every other request), so the answer is kept per project
    until its config/features.yaml or config/profile.yaml changes on disk."""
    key = (_mtime("config/features.yaml"), _mtime("config/profile.yaml"))
    cache = _switches.setdefault(str(kit_dir()), {"key": None})
    if cache["key"] != key:
        f = features_module()
        items = f.load_items()
        cache.update(key=key, ids=set(items), on=set(f.effective_on(items, f.load_off())))
    return feature_id not in cache["ids"] or feature_id in cache["on"]


def guardrails() -> dict:
    return read_yaml("config/guardrails.yaml", {}) or {}


def env_example_accounts() -> list[str]:
    import re
    p = kit_dir() / ".env.example"
    if not p.exists():
        return []
    return re.findall(r"^([A-Z0-9_]+)_USER=", p.read_text(encoding="utf-8"), re.M)


def env_values() -> dict[str, str]:
    """The private .env file as a dict. Only the app reads it; agents never see these values."""
    import re
    out = {}
    p = kit_dir() / ".env"
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


def account_label(name: str) -> str:
    """'EMPLOYEE_TEST_ACCOUNT' -> 'Employee test account'."""
    words = [w for w in str(name or "").split("_") if w]
    if not words:
        return name
    return " ".join([words[0].capitalize(), *(w.lower() for w in words[1:])])


def cases_source() -> dict:
    """Which test cases Studio knows best: the newer of the newest run's and the Excel given to login setup.
    {"source": "run <id>" | "login setup" | "", "excel": file name, "file": path, "cases": [...]}."""
    found = []
    for run_id in list_runs():
        f = runs_dir() / run_id / "cases.json"
        cases = read_json(f)
        if cases:
            excel = (read_json(runs_dir() / run_id / "progress.json", {}) or {}).get("excel", "")
            found.append({"source": f"run {run_id}", "excel": Path(excel).name, "file": f, "cases": cases})
            break
    f = runs_dir() / "setup" / "cases.json"
    cases = read_json(f)
    if cases:
        name = runs_dir() / "setup" / "requirements-name.txt"
        found.append({"source": "login setup", "file": f, "cases": cases,
                      "excel": name.read_text(encoding="utf-8").strip() if name.exists() else "requirements.xlsx"})
    if not found:
        return {"source": "", "excel": "", "file": None, "cases": []}
    return max(found, key=lambda x: x["file"].stat().st_mtime)


def latest_cases() -> tuple[str, list[dict]]:
    """The test cases the login agent and the account list start from (see cases_source)."""
    s = cases_source()
    return (f"{s['excel']} ({s['source']})" if s["source"] else ""), s["cases"]


def accounts_overview(cases: list[dict]) -> list[dict]:
    """Every test account Studio knows of: entered on the Setup page or named in the cases' "Login as".
    Says whether its values are filled in (never the values) and which cases use it."""
    values = env_values()
    used: dict[str, list[str]] = {}
    for c in cases:
        if c.get("login_as"):
            used.setdefault(account_key(c["login_as"]), []).append(c.get("test_id", "?"))
    names = list(dict.fromkeys([*env_example_accounts(), *(k[:-5] for k in values if k.endswith("_USER")), *used]))
    return [{"name": n, "label": account_label(n), "user": values.get(f"{n}_USER", ""),
             "user_set": bool(values.get(f"{n}_USER")), "password_set": bool(values.get(f"{n}_PASSWORD")),
             "used_by": used.get(n, [])} for n in names]
