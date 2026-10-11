"""Sign-off decisions, manual results, closing, and the files that come out (results, clarified Excel)."""
from __future__ import annotations

import importlib.util
import subprocess

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import kit, signoff_reset
from ..engine import engine
from ..interactions import interactions
from .common import raise_on_error, run_or_404

router = APIRouter()


class DecisionIn(BaseModel):
    unit: str
    decision: str
    by: str
    reason: str = ""


class ManualIn(BaseModel):
    test_id: str
    result: str
    by: str
    note: str = ""
    evidence: str = ""


@router.post("/runs/{run_id}/signoff/decision")
async def signoff_decision(run_id: str, body: DecisionIn):
    run_or_404(run_id)
    args = [f"runs/{run_id}", "--unit", body.unit, "--decision", body.decision, "--by", body.by]
    if body.reason:
        args += ["--reason", body.reason]
    r = await kit.run_script("record_decision", *args)
    raise_on_error(r)
    return {"output": r.output}


@router.post("/runs/{run_id}/signoff/manual")
async def signoff_manual(run_id: str, body: ManualIn):
    run_or_404(run_id)
    args = [f"runs/{run_id}", "--manual", body.test_id, "--result", body.result, "--by", body.by]
    if body.note:
        args += ["--note", body.note]
    if body.evidence:
        args += ["--evidence", body.evidence]
    r = await kit.run_script("record_decision", *args)
    raise_on_error(r)
    return {"output": r.output}


@router.post("/runs/{run_id}/signoff/complete")
async def signoff_complete(run_id: str):
    run_or_404(run_id)
    r = await kit.run_script("record_decision", f"runs/{run_id}", "--complete")
    raise_on_error(r)
    pending = [i for i in interactions.list(run_id) if i["kind"] == "signoff"]
    if pending:
        interactions.answer(pending[0]["id"], "sign-off closed")
    elif not engine.is_running(run_id):
        engine.start(run_id)                      # resumes the sign-off stage, which writes the results
    return {"output": r.output}


@router.post("/runs/{run_id}/signoff/redo")
async def redo_signoff(run_id: str):
    """Sign off again from scratch: every decision, manual result and the seal are cleared (kept in the run's
    earlier-signoffs folder), then the sign-off stage runs again and asks the person."""
    p = run_or_404(run_id)
    if engine.is_running(run_id):
        raise HTTPException(409, "The run is running. Stop it first.")
    kept = signoff_reset.archive(p)
    raise_on_error(await kit.run_script("progress", "stage", f"runs/{run_id}", "signoff", "started",
                                        "--note", "sign-off done again by the person"))
    engine.start(run_id)
    return {"running": True, "kept_in": kept}


@router.get("/runs/{run_id}/clarified.xlsx")
def clarified_excel(run_id: str):
    """The run's cases as clarified, in the agreed template: the author pastes them back into their Excel,
    so the answers are not asked again next time (REVIEW.md 2.10 b)."""
    p = run_or_404(run_id)
    cases = kit.read_json(p / "cases.json", []) or []
    if not cases:
        raise HTTPException(404, "The Excel has not been read yet")
    spec = importlib.util.spec_from_file_location("make_template", kit.KIT_DIR / kit.SCRIPTS["make_template"])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)                       # type: ignore[union-attr]
    rows = []
    for c in cases:
        row = {k: v for k, v in c.items() if isinstance(v, str)}
        row["steps"] = "\n".join(f"{s.get('n')}. {s['text']}" for s in c.get("steps", []))
        row["expected_results"] = "\n".join(f"{e.get('step')}. {e['text']}" for e in c.get("expected_results", []))
        if c.get("open_questions"):
            row["notes"] = ("OPEN QUESTIONS (see clarifications.md). " + row.get("notes", "")).strip()
        rows.append(row)
    out = p / "clarified-cases.xlsx"
    module.build(out, rows, guide=False)
    return FileResponse(out, filename=f"clarified-cases-{run_id}.xlsx")


class TraceIn(BaseModel):
    path: str


@router.post("/runs/{run_id}/open-trace")
def open_trace(run_id: str, body: TraceIn):
    """Open a test's trace in Playwright's trace viewer, on this machine."""
    p = run_or_404(run_id)
    f = (p / body.path).resolve()
    if p.resolve() not in f.parents or f.suffix != ".zip" or not f.is_file():
        raise HTTPException(400, "Not a trace of this run")
    cmd = subprocess.list2cmdline(["npx", "playwright", "show-trace", str(f)])
    subprocess.Popen(cmd, cwd=kit.KIT_DIR, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"opened": True}


@router.get("/runs/{run_id}/results.xlsx")
def results_file(run_id: str):
    p = run_or_404(run_id) / "results.xlsx"
    if not p.exists():
        raise HTTPException(404, "results.xlsx is not written yet")
    return FileResponse(p, filename=f"results-{run_id}.xlsx")
