"""Helpers every route module shares."""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from .. import kit

RUN_FILES = ["progress.json", "cases.json", "cases-original.json", "changes.json", "generate-list.json", "test-check.json",
             "flakiness.json", "evidence-check.json", "diagnoses.json", "console-new.json", "screens.json",
             "screens-review.json", "usage.json", "signoff.json", "manifest.json", "studio-reasoning.json",
             "studio-state.json", "studio-validation.json"]
RUN_TEXTS = ["changes.md", "clarifications.md", "questionnaire.md", "mismatches.md", "console.md", "diagnoses.md",
             "excel-updates.md"]


def run_or_404(run_id: str) -> Path:
    """The run's folder in the current project, or a 404."""
    try:
        p = kit.run_path(run_id)
    except ValueError:
        raise HTTPException(404, "No such run") from None
    if not kit.is_run(p):
        raise HTTPException(404, "No such run")
    return p


def raise_on_error(r) -> None:
    """A kit script that failed becomes a 400 carrying its own output."""
    if r.code != 0:
        raise HTTPException(400, r.output or f"exit {r.code}")
