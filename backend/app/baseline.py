"""Which earlier run a run's screenshots are compared with (the screens stage).

The person may choose one run per project as the baseline. Without a choice, it is the latest run that has
screenshots. A run is never its own baseline: then the latest earlier run with screenshots is used.
"""
from __future__ import annotations

from . import kit, projects


def has_screens(run_id: str) -> bool:
    return any(kit.run_path(run_id).glob("evidence*/screenshots/*.png"))


def chosen() -> str | None:
    """The run the person chose for the current project, while it still exists."""
    p = projects.get(projects.current_id()) or {}
    rid = p.get("baseline_run")
    return rid if rid and rid in kit.list_runs() else None


def latest(before: str | None = None) -> str | None:
    """The newest run with screenshots (older than `before` when given)."""
    return next((r for r in kit.list_runs() if (before is None or r < before) and has_screens(r)), None)


def for_run(run_id: str) -> str | None:
    c = chosen()
    return c if c and c != run_id else latest(before=run_id)


def current() -> tuple[str | None, bool]:
    """What the next run compares with, and whether the person chose it (False: the latest, automatically)."""
    c = chosen()
    return (c, True) if c else (latest(), False)
