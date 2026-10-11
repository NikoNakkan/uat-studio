"""Running the kit's scripts and commands: one at a time per caller, output streamed, and stoppable.

Commands belong to whoever started them (a run id, or "app" for setup work), per project, so Stop ends
exactly that caller's process tree, including what npx or the browser started under it.
"""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import os
import signal
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass

from . import projects

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
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
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


def _popen_kwargs(private: bool = False):
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    if private:                       # the kit's scripts (tests, login check): the start page and accounts
        from .accounts import env_values  # noqa: PLC0415
        env.update(env_values())
    kw = {"cwd": projects.current_dir(), "env": env, "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT,
          "text": True, "encoding": "utf-8", "errors": "replace", "shell": os.name == "nt"}
    if os.name == "nt":
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    return kw


def _run_blocking(cmd: list[str], timeout: float | None, on_line: Callable[[str], None] | None,
                  private: bool = False) -> ScriptResult:
    kwargs = _popen_kwargs(private)
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
            for raw in proc.stdout:
                line = raw.rstrip("\n")
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


def _on_loop(loop: asyncio.AbstractEventLoop, on_line: Callable[[str], None] | None) -> Callable[[str], None] | None:
    """Hand each output line (read in a worker thread) to on_line on the event loop."""
    if on_line is None:
        return None

    def forward(line: str) -> None:
        loop.call_soon_threadsafe(on_line, line)
    return forward


async def run_script(name: str, *args: str, timeout: float | None = 900,
                     on_line: Callable[[str], None] | None = None) -> ScriptResult:
    """Run one of the kit's Python scripts with the app's Python (same packages)."""
    cmd = [PY, SCRIPTS[name], *[str(a) for a in args]]
    loop = asyncio.get_running_loop()
    return await asyncio.to_thread(_run_blocking, cmd, timeout, _on_loop(loop, on_line), True)


async def run_command(cmd: list[str], timeout: float | None = 1800,
                      on_line: Callable[[str], None] | None = None) -> ScriptResult:
    loop = asyncio.get_running_loop()
    return await asyncio.to_thread(_run_blocking, cmd, timeout, _on_loop(loop, on_line))
