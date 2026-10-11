"""Projects: one app under test each, each in its own kit folder.

A project folder holds everything that belongs to one app: its allowed sites, tests/login.ts,
the generated tests, the app map, the glossary, the feature switches and the runs. Its start page and test
accounts are kept by Studio (vault.py), never in the folder. The kit's code (scripts, agents, skills,
templates) is copied in from the main kit when the project is created, and can be updated from it later;
the kit's scripts work relative to their own folder, so they need no change.

Which project a request is for comes from the uat_project cookie (set by the project switcher) and is kept
in a context variable. A run started in a project keeps that project for its whole life, because asyncio
tasks copy the context they are created in.
"""
from __future__ import annotations

import contextvars
import json
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from .settings import KIT_DIR, STATE_DIR

REGISTRY = STATE_DIR / "projects.json"
MAIN = "main"
_current: contextvars.ContextVar[str | None] = contextvars.ContextVar("uat_project", default=None)

# The kit's code: copied into a new project, and refreshed by "Update kit files".
CODE = [".github", "scripts", "templates", ".vscode", "playwright.config.ts", "package.json", "package-lock.json",
        "requirements.txt", "AGENTS.md", ".gitignore",
        "tests/fixtures.ts", "tests/canvas.ts", "tests/canvas-fixtures.ts", "tests/login.check.spec.ts", "tests/seed.spec.ts"]
# Rules a team may tune per project: copied once at creation, never overwritten by an update.
CONFIG = "config"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "project"


def _load() -> dict:
    try:
        data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    projects = data.get("projects") or []
    if not any(p["id"] == MAIN for p in projects):           # the kit Studio started with is always a project
        projects.insert(0, {"id": MAIN, "name": "Main project", "dir": str(KIT_DIR), "created": ""})
    return {"projects": projects, "active": data.get("active") or MAIN}


def _save(data: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(data, indent=2), encoding="utf-8")


def all_projects() -> list[dict]:
    return _load()["projects"]


def get(pid: str | None) -> dict | None:
    return next((p for p in all_projects() if p["id"] == pid), None)


def current_id() -> str:
    pid = _current.get()
    if pid and get(pid):
        return pid
    active = _load()["active"]
    return active if get(active) else MAIN


def current_dir() -> Path:
    p = get(current_id())
    if p and p["id"] == MAIN:                                   # follows UAT_KIT_DIR, as before projects existed
        return KIT_DIR
    return Path(p["dir"]) if p else KIT_DIR


def use(pid: str | None) -> contextvars.Token:
    """Make pid the project of the current request (or task). Unknown ids fall back to the active one."""
    return _current.set(pid if pid and get(pid) else None)


def reset(token: contextvars.Token) -> None:
    _current.reset(token)


def set_active(pid: str) -> None:
    data = _load()
    if not any(p["id"] == pid for p in data["projects"]):
        raise KeyError(pid)
    data["active"] = pid
    _save(data)


def rename(pid: str, name: str) -> dict:
    data = _load()
    for p in data["projects"]:
        if p["id"] == pid:
            p["name"] = name.strip() or p["name"]
            _save(data)
            return p
    raise KeyError(pid)


MANUAL_HOURS = 4.0      # how long a person needs to test an app by hand, until the project says otherwise


def savings(p: dict) -> dict:
    """What testing this app by hand costs: a person's hourly rate (None until someone enters it) and hours."""
    s = p.get("savings") or {}
    return {"hourly_rate": s.get("hourly_rate"), "manual_hours": s.get("manual_hours", MANUAL_HOURS)}


def _set(pid: str, key: str, value) -> dict:
    data = _load()
    for p in data["projects"]:
        if p["id"] == pid:
            p[key] = value
            _save(data)
            return p
    raise KeyError(pid)


def set_savings(pid: str, hourly_rate: float | None, manual_hours: float) -> dict:
    return savings(_set(pid, "savings", {"hourly_rate": hourly_rate, "manual_hours": manual_hours}))


def set_baseline(pid: str, run_id: str | None) -> str | None:
    """The run new runs compare their screenshots with; None means the latest run that has screenshots."""
    return _set(pid, "baseline_run", run_id).get("baseline_run")


def _copy(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    elif src.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def _link_node_modules(target: Path) -> str:
    """Share the main kit's node_modules (Playwright) instead of a second install: a directory junction on
    Windows (no admin rights needed), a symlink elsewhere. Returns a note for the person."""
    src = KIT_DIR / "node_modules"
    dst = target / "node_modules"
    if dst.exists() or not src.exists():
        return "" if dst.exists() else "Run npm install in the project folder (Setup offers it)."
    try:
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", str(dst), str(src)], check=True, capture_output=True)
        else:
            dst.symlink_to(src, target_is_directory=True)
        return ""
    except (OSError, subprocess.CalledProcessError):
        return "Could not share node_modules: run npm install in the project folder (Setup offers it)."


def sync_code(target: Path) -> list[str]:
    """Copy the main kit's code into a project folder; tests, app map, runs and config stay as they are.
    Config files the project does not have yet are added."""
    if target.resolve() == KIT_DIR.resolve():
        return []
    copied = []
    for rel in CODE:
        if (KIT_DIR / rel).exists():
            _copy(KIT_DIR / rel, target / rel)
            copied.append(rel)
    for f in (KIT_DIR / CONFIG).glob("*"):
        if f.is_file() and not (target / CONFIG / f.name).exists():
            _copy(f, target / CONFIG / f.name)
            copied.append(f"{CONFIG}/{f.name}")
    return copied


def _origin(url: str) -> str:
    u = urlparse(url)
    return f"{u.scheme}://{u.netloc}" if u.scheme in ("http", "https") and u.netloc else ""


def create(name: str, start_page: str, root: Path | None = None) -> dict:
    """A new project folder: the kit's code and rules, and everything app-specific blank."""
    name = name.strip()
    if not name:
        raise ValueError("Give the project a name, e.g. Lumen Clinic")
    origin = _origin(start_page.strip())
    if not origin:
        raise ValueError("Give the start page as a full address, e.g. https://test.app.example.com")
    data = _load()
    pid = base = slug(name)
    n = 2
    while any(p["id"] == pid for p in data["projects"]):
        pid, n = f"{base}-{n}", n + 1
    folder = (root or KIT_DIR.parent / "uat-projects") / pid
    if folder.exists() and any(folder.iterdir()):
        raise ValueError(f"The folder {folder} already exists and is not empty.")
    folder.mkdir(parents=True, exist_ok=True)

    sync_code(folder)
    _copy(KIT_DIR / CONFIG, folder / CONFIG)
    (folder / CONFIG / "profile.yaml").write_text(
        "# Which parts of the UAT flow are switched off for this project (see config/features.yaml).\n"
        "switched_off: []\n", encoding="utf-8")
    guard = folder / CONFIG / "guardrails.yaml"
    text = guard.read_text(encoding="utf-8")
    guard.write_text(re.sub(r"^allowed_origins:.*?(?=^\S)", f"allowed_origins:\n  - {origin}\n\n", text, count=1,
                            flags=re.S | re.M), encoding="utf-8")
    _copy(KIT_DIR / "templates" / "login.ts", folder / "tests" / "login.ts")
    for rel, body in {
        "GLOSSARY.md": f"# {name}: the app's own words\n\nAdded by the clarifier as the test author explains them.\n",
        "app-map/README.md": "The pages and elements Playwright's planner saw in the app. Written by merge_app_map.py.\n",
        "specs/README.md": "Playwright plans, written by excel_to_plan.py. Do not edit by hand.\n",
        "runs/.gitkeep": "",
    }.items():
        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
        (folder / rel).write_text(body, encoding="utf-8")
    note = _link_node_modules(folder)
    from . import vault  # noqa: PLC0415 - vault imports settings, which this module also uses
    vault.put(pid, "START_PAGE", start_page.strip())

    project = {"id": pid, "name": name, "dir": str(folder), "created": datetime.now().isoformat(timespec="seconds")}
    data["projects"].append(project)
    _save(data)
    return {**project, "note": note}
