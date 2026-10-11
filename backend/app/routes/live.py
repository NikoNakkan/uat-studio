"""What a run shows while and after it runs: live events (SSE), screen comparison, its files."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent

from .. import kit
from ..events import bus
from .common import run_or_404

router = APIRouter()


@router.get("/runs/{run_id}/events", response_class=EventSourceResponse)
async def run_events(run_id: str, after: int = 0, last_event_id: str | None = Header(None)):
    run_or_404(run_id)
    async for e in _stream(run_id, _resume_from(after, last_event_id)):
        yield e


@router.get("/events/app", response_class=EventSourceResponse)
async def app_events(after: int = 0, last_event_id: str | None = Header(None)):
    async for e in _stream("app", _resume_from(after, last_event_id)):
        yield e


def _resume_from(after: int, last_event_id: str | None) -> int:
    """A browser that reconnects sends Last-Event-ID: continue after it instead of replaying the whole history."""
    try:
        return max(after, int(last_event_id or 0))
    except ValueError:
        return after


async def _stream(channel: str, after: int):
    q = bus.subscribe(channel)
    try:
        last = after
        for e in bus.history(channel, after):
            last = e["seq"]
            yield ServerSentEvent(data=e, id=str(e["seq"]))
        while True:
            try:
                e = await asyncio.wait_for(q.get(), timeout=15)
            except TimeoutError:
                yield ServerSentEvent(comment="keep-alive")
                continue
            if e["seq"] > last:
                last = e["seq"]
                yield ServerSentEvent(data=e, id=str(e["seq"]))
    finally:
        bus.unsubscribe(channel, q)


@router.get("/runs/{run_id}/visual")
def visual_regression(run_id: str):
    """Every test's step screenshots next to the last signed-off run, with the AI screen reviewer's comments."""
    p = run_or_404(run_id)
    screens = kit.read_json(p / "screens.json") or {}
    review = kit.read_json(p / "screens-review.json", {}) or {}
    cases = {c["test_id"]: c for c in kit.read_json(p / "cases.json", []) or []}
    results = (kit.read_json(p / "progress.json", {}) or {}).get("tests", {})
    checks = (kit.read_json(p / "evidence-check.json", {}) or {}).get("tests", {})
    pairs = screens.get("pairs")
    if pairs is None:                     # screens.json written before pairs existed: changed screens only
        pairs = [{**f, "status": "changed"} for f in screens.get("flagged", [])]
    tests: dict[str, dict] = {}
    for pair in sorted(pairs, key=lambda x: (x["test_id"], x["step"])):
        tid = pair["test_id"]
        case = cases.get(tid, {})
        t = tests.setdefault(tid, {"test_id": tid, "title": case.get("title", ""), "group": case.get("group", ""),
                                   "result": results.get(tid, {}).get("result", ""),
                                   "recommendation": checks.get(tid, {}).get("recommendation", ""),
                                   "counts": {"changed": 0, "unchanged": 0, "new": 0}, "steps": []})
        t["counts"][pair["status"]] = t["counts"].get(pair["status"], 0) + 1
        step_text = next((s["text"] for s in case.get("steps", []) if s.get("n") == pair["step"]), "")
        t["steps"].append({**pair, "step_text": step_text,
                           "expected": [e["text"] for e in case.get("expected_results", []) if e.get("step") == pair["step"]],
                           "ai": review.get(pair["name"])})
    return {"baseline_run": screens.get("baseline_run"), "ai_review": screens.get("ai_review"),
            "skipped": screens.get("skipped"), "compared": screens.get("compared", 0),
            "tests": sorted(tests.values(), key=lambda t: (-t["counts"]["changed"], t["test_id"]))}


@router.get("/runs/{run_id}/file")
def run_file(run_id: str, path: str):
    p = run_or_404(run_id)
    f = (p / path).resolve()
    if p.resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, "No such file in this run")
    return FileResponse(f)


@router.get("/runs/{run_id}/files")
def run_files(run_id: str, folder: str = ""):
    p = run_or_404(run_id)
    base = (p / folder).resolve()
    if p.resolve() != base and p.resolve() not in base.parents:
        raise HTTPException(400, "Outside the run")
    return [x.relative_to(p).as_posix() for x in sorted(base.rglob("*")) if x.is_file()][:2000]
