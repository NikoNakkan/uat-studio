"""The bridge to the kit: run its scripts, read its files, use its feature map.

The kit's scripts stay the single source of truth for every deterministic step. The app never
re-implements them; it runs them exactly as the agents in VS Code would, and shows their output.
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml

from . import projects

# Running scripts lives in processes.py; kit re-exports what the rest of the app uses.
from .processes import (
    FIX_COMMANDS as FIX_COMMANDS,
)
from .processes import (
    PY as PY,
)
from .processes import (
    SCRIPTS as SCRIPTS,
)
from .processes import (
    ScriptResult as ScriptResult,
)
from .processes import (
    kill_owned as kill_owned,
)
from .processes import (
    pop_script_owner as pop_script_owner,
)
from .processes import (
    push_script_owner as push_script_owner,
)
from .processes import (
    run_command as run_command,
)
from .processes import (
    run_script as run_script,
)
from .processes import (
    script_owner as script_owner,
)


def kit_dir() -> Path:
    """The kit folder of the current project (see projects.py)."""
    return projects.current_dir()


def __getattr__(name: str):
    # kit.KIT_DIR is read at the moment it is used, so it is always the current request's (or run's) project.
    if name == "KIT_DIR":
        return kit_dir()
    raise AttributeError(name)

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
