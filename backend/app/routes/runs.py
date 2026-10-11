"""Runs: list, create (from an upload or the latest Excel), start, stop, delete, retry a stage."""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import stat
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import accounts, kit
from ..engine import engine
from ..events import bus
from ..interactions import interactions
from .common import RUN_FILES, RUN_TEXTS, raise_on_error, run_or_404

router = APIRouter()


def _stage_rows(progress: dict) -> list[dict]:
    rows = []
    for s in kit.workflow()["stages"]:
        st = progress.get("stages", {}).get(s["id"], {})
        rows.append({"id": s["id"], "feature": s.get("feature"), "on": kit.is_on(s.get("feature", "")),
                     "agent": s.get("agent"), "does": s.get("does", ""), "stop_for_person": s.get("stop_for_person"),
                     "status": st.get("status", "-"), "note": st.get("note", ""), "at": st.get("at")})
    return rows


@router.get("/runs")
def list_runs():
    out = []
    for rid in kit.list_runs():
        p = kit.run_path(rid)
        prog = kit.read_json(p / "progress.json", {}) or {}
        stages = prog.get("stages", {})
        current = next((s for s, v in reversed(list(stages.items())) if v.get("status") not in ("done", "skipped")), None)
        tests = prog.get("tests", {})
        out.append({"id": rid, "excel": prog.get("excel"), "created": prog.get("created"),
                    "strictness": prog.get("strictness"),
                    "stages_done": sum(v.get("status") in ("done", "skipped") for v in stages.values()),
                    "stages_total": len(kit.workflow()["stages"]), "current": current,
                    "tests": len(tests), "passed": sum(t.get("result") == "passed" for t in tests.values()),
                    "sealed": (p / "manifest.json").exists(), "results": (p / "results.xlsx").exists(),
                    "running": engine.is_running(rid), "waiting": len(interactions.list(rid))})
    return out


@router.post("/runs")
async def create_run(file: UploadFile | None = File(None), strictness: str = Form("standard"), start: bool = Form(True),
                     reuse: str = Form("")):
    """A new run from an uploaded Excel, or (reuse="latest") from the Excel Studio already has: the newest run's
    or the one given to login setup, so the same file need not be uploaded again."""
    if strictness not in ("basic", "standard", "strict"):
        raise HTTPException(400, "Strictness is basic, standard or strict.")
    if file is not None and file.filename:
        if not file.filename.lower().endswith(".xlsx"):
            raise HTTPException(400, "Upload the Excel file (.xlsx) in the agreed template.")
        tmp = Path(tempfile.mkdtemp()) / Path(file.filename).name
        with tmp.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    elif reuse == "latest":
        src = accounts.cases_source()
        if not src["xlsx"] or not src["xlsx"].exists():
            raise HTTPException(400, "There is no earlier Excel to reuse. Choose the Excel file.")
        tmp = Path(tempfile.mkdtemp()) / (src["excel"] or "test-cases.xlsx")
        shutil.copyfile(src["xlsx"], tmp)
    else:
        raise HTTPException(400, "Choose the Excel file (.xlsx) in the agreed template.")
    r = await kit.run_script("progress", "new", str(tmp), "--strictness", strictness)
    shutil.rmtree(tmp.parent, ignore_errors=True)
    m = re.search(r"RUN runs/(\S+)", r.output)
    if r.code != 0 or not m:
        raise HTTPException(400, r.output)
    run_id = m.group(1)
    if start:
        try:
            engine.start(run_id)
        except RuntimeError as e:
            return {"id": run_id, "started": False, "message": str(e)}
    return {"id": run_id, "started": start}


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    p = run_or_404(run_id)
    data: dict[str, Any] = {name.removesuffix(".json").replace("-", "_"): kit.read_json(p / name) for name in RUN_FILES}
    texts = {name: (p / name).read_text(encoding="utf-8") for name in RUN_TEXTS if (p / name).exists()}
    folders = sorted(x.name for x in p.iterdir() if x.is_dir())
    return {"id": run_id, "data": data, "texts": texts, "folders": folders,
            "stages": _stage_rows(data["progress"] or {}), "running": engine.is_running(run_id),
            "pending": interactions.list(run_id), "results_ready": (p / "results.xlsx").exists()}


@router.post("/runs/{run_id}/start")
async def start_run(run_id: str):
    """Start or resume a run. Async on purpose: engine.start creates a task on the server's event loop, which a
    plain def endpoint (run on a worker thread) does not have: Resume failed with "no running event loop"."""
    run_or_404(run_id)
    try:
        engine.start(run_id)
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from None
    return {"running": True}


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str):
    await engine.stop_and_wait(run_id, timeout=10)
    return {"running": engine.is_running(run_id)}


async def _delete_tree(path: Path) -> None:
    """Remove a run folder. A browser or test can keep a file locked for a moment after Stop kills it."""
    def once() -> None:
        def onerror(func, p, exc):
            os.chmod(p, stat.S_IWRITE)
            func(p)
        shutil.rmtree(path, onerror=onerror)

    last: OSError | None = None
    for _ in range(8):
        try:
            await asyncio.to_thread(once)
            return
        except FileNotFoundError:
            return
        except OSError as e:
            last = e
            await asyncio.sleep(0.3)
    raise HTTPException(409, "Some files are still in use (a browser or test may still be closing). "
                         f"Try again in a moment. ({last})") from None


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str, signed_off: bool = False):
    """Stops the run if it is running, then removes its folder: evidence, screenshots, record. The tests it
    generated stay in tests/, because later runs reuse them. A signed-off run needs signed_off=true."""
    try:
        p = kit.run_path(run_id)
    except ValueError:
        raise HTTPException(400, "Not a run.") from None
    if not p.exists():
        raise HTTPException(404, "No such run.")
    if (p / "manifest.json").exists() and not signed_off:
        raise HTTPException(409, "This run is signed off: its record is sealed evidence. Confirm deleting a signed-off run.")
    if not await engine.stop_and_wait(run_id):
        raise HTTPException(409, "The run is still stopping. Try again in a moment.")
    await _delete_tree(p)
    engine.forget(run_id)
    bus.forget(run_id)
    return {"deleted": run_id}


class RetryIn(BaseModel):
    stage: str


@router.post("/runs/{run_id}/retry")
async def retry_stage(run_id: str, body: RetryIn):
    """Mark a failed or waiting stage as not started, then resume the run from it."""
    run_or_404(run_id)
    if engine.is_running(run_id):
        raise HTTPException(409, "The run is running.")
    r = await kit.run_script("progress", "stage", f"runs/{run_id}", body.stage, "started", "--note", "retried by the person")
    raise_on_error(r)
    engine.start(run_id)
    return {"running": True}
