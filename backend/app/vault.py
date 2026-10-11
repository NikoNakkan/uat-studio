"""A project's private values: the start page and the test accounts' user names and passwords.

Studio keeps them in its own settings folder (STATE_DIR/projects/<project>/private.json, owner-only where the
file system allows it), never in the project, so nobody has to create a .env and no project folder holds a
password. They reach the kit's scripts and the Playwright server only as environment variables while those run;
agents never see them. A project's .env, from before this or from using the kit on its own in VS Code, is still
read, and Studio's own values win over it.
"""
from __future__ import annotations

import contextlib
import json
import re
from pathlib import Path

from .settings import STATE_DIR


def _file(pid: str) -> Path:
    return STATE_DIR / "projects" / pid / "private.json"


def dotenv(folder: Path) -> dict[str, str]:
    """A .env file as a dict (empty when there is none)."""
    out: dict[str, str] = {}
    p = folder / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                out[m.group(1)] = m.group(2).strip('"').strip("'")
    return out


def stored(pid: str) -> dict[str, str]:
    try:
        data = json.loads(_file(pid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}


def values(pid: str, folder: Path) -> dict[str, str]:
    """Everything the tests may need: the project's .env (if any), overridden by what Studio keeps."""
    return {**dotenv(folder), **stored(pid)}


def put(pid: str, key: str, value: str) -> None:
    """Save one value (an empty value removes it)."""
    if not re.fullmatch(r"[A-Z0-9_]+", key):
        raise ValueError(f"Not a setting name: {key}")
    if "\n" in value or "\r" in value:
        raise ValueError("One line only")
    data = stored(pid)
    if value:
        data[key] = value
    else:
        data.pop(key, None)
    f = _file(pid)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    with contextlib.suppress(OSError):
        f.chmod(0o600)
