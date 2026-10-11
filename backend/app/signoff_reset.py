"""Undo a sign-off so it can be done again.

The seal (manifest.json), the decisions and manual results (signoff.json), results.xlsx and the reporter's
reasoning move to earlier-signoffs/<time>/ inside the run: kept as a record of who decided what, never deleted.
The evidence itself stays; the sign-off stage checks it again before asking the person.
"""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

FILES = ("manifest.json", "signoff.json", "results.xlsx", "studio-reasoning.json")
FOLDER = "earlier-signoffs"


def archive(run: Path) -> str | None:
    """Move the sign-off files aside; returns the folder they went to (relative to the run), or None."""
    present = [name for name in FILES if (run / name).exists()]
    if not present:
        return None
    dest = run / FOLDER / datetime.now().strftime("%Y-%m-%d-%H%M%S")
    dest.mkdir(parents=True, exist_ok=True)
    for name in present:
        shutil.move(str(run / name), str(dest / name))
    return dest.relative_to(run).as_posix()
