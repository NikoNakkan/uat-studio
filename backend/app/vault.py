"""A project's private values: the start page and the test accounts' user names and passwords.

Studio keeps them in its own settings folder (STATE_DIR/projects/<project>/private.json, owner-only where the
file system allows it), never in the project, so nobody has to create a .env and no project folder holds a
password. They reach the kit's scripts and the Playwright server only as environment variables while those run;
agents never see them. No .env is read: a project that had one before gets its values copied in once.
"""
from __future__ import annotations

import contextlib
import json
import re
from pathlib import Path

from .settings import STATE_DIR


def _file(pid: str) -> Path:
    return STATE_DIR / "projects" / pid / "private.json"


ACCOUNTS = "UAT_ACCOUNTS"   # the accounts added on Setup before their values are typed (comma-separated keys)


def _dotenv(folder: Path) -> dict[str, str]:
    """An old .env as a dict (empty when there is none). Only for the one-time copy below."""
    out: dict[str, str] = {}
    p = folder / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m and m.group(2):
                out[m.group(1)] = m.group(2).strip('"').strip("'")
    return out


def stored(pid: str) -> dict[str, str]:
    try:
        data = json.loads(_file(pid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}


def values(pid: str, folder: Path) -> dict[str, str]:
    """Everything the tests may need. A project with an old .env and nothing kept yet gets it copied in once."""
    if not _file(pid).exists() and (old := _dotenv(folder)):
        _save(pid, old)
    return {k: v for k, v in stored(pid).items() if k != ACCOUNTS}


def accounts(pid: str) -> list[str]:
    return [a for a in stored(pid).get(ACCOUNTS, "").split(",") if a]


def add_account(pid: str, key: str) -> bool:
    """Remember an account by name before its values are typed. False when it was already known."""
    known = accounts(pid)
    if key in known or f"{key}_USER" in stored(pid):
        return False
    put(pid, ACCOUNTS, ",".join([*known, key]))
    return True


def _save(pid: str, data: dict[str, str]) -> None:
    f = _file(pid)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    with contextlib.suppress(OSError):
        f.chmod(0o600)


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
    _save(pid, data)
