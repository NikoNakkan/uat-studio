"""HTTP API for the React app."""
from __future__ import annotations

import asyncio
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

from . import kit
from .engine import engine
from .events import bus
from .interactions import interactions
from .llm import MissingApiKey, client
from .settings import AGENTS, load_settings, save_settings

router = APIRouter(prefix="/api")
RUN_FILES = ["progress.json", "cases.json", "cases-original.json", "changes.json", "generate-list.json", "test-check.json",
             "flakiness.json", "evidence-check.json", "diagnoses.json", "console-new.json", "screens.json",
             "screens-review.json", "usage.json", "signoff.json", "manifest.json", "studio-reasoning.json",
             "studio-state.json", "studio-validation.json"]
RUN_TEXTS = ["changes.md", "clarifications.md", "questionnaire.md", "mismatches.md", "console.md", "diagnoses.md",
             "excel-updates.md"]


def _run_or_404(run_id: str) -> Path:
    try:
        p = kit.run_path(run_id)
    except ValueError:
        raise HTTPException(404, "No such run") from None
    if not kit.is_run(p):
        raise HTTPException(404, "No such run")
    return p


def _err(r) -> None:
    if r.code != 0:
        raise HTTPException(400, r.output or f"exit {r.code}")


# ---------------- health and settings ----------------

@router.get("/health")
def health():
    return {"ok": True, "kit": str(kit.KIT_DIR), "kit_found": (kit.KIT_DIR / "AGENTS.md").exists(),
            "running": engine.running()}


class SettingsIn(BaseModel):
    api_key: str | None = None
    clear_api_key: bool = False
    models: dict[str, str] | None = None
    default_model: str | None = None
    max_turns: int | None = None
    max_output_tokens: int | None = None
    show_agent_browser: bool | None = None


@router.get("/settings")
def get_settings():
    return load_settings().public()


@router.put("/settings")
def put_settings(body: SettingsIn):
    s = load_settings()
    if body.clear_api_key:
        s.api_key = ""
    elif body.api_key:
        s.api_key = body.api_key.strip()
    if body.models is not None:
        s.models = {a: m for a, m in body.models.items() if a in AGENTS and m}
    for field in ("default_model", "max_turns", "max_output_tokens", "show_agent_browser"):
        if getattr(body, field) is not None:
            setattr(s, field, getattr(body, field))
    save_settings(s)
    return s.public()


@router.post("/settings/test")
async def test_key():
    try:
        r = await client().messages.create(model=load_settings().default_model, max_tokens=20,
                                           messages=[{"role": "user", "content": "Answer with the single word: ready"}])
        return {"ok": True, "answer": "".join(b.text for b in r.content if b.type == "text"), "model": r.model}
    except MissingApiKey as e:
        raise HTTPException(400, str(e)) from None
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"The API refused: {e}") from None


# ---------------- runs ----------------

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
async def create_run(file: UploadFile = File(...), strictness: str = Form("standard"), start: bool = Form(True)):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload the Excel file (.xlsx) in the agreed template.")
    if strictness not in ("basic", "standard", "strict"):
        raise HTTPException(400, "Strictness is basic, standard or strict.")
    tmp = Path(tempfile.mkdtemp()) / Path(file.filename).name
    with tmp.open("wb") as f:
        shutil.copyfileobj(file.file, f)
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
    p = _run_or_404(run_id)
    data: dict[str, Any] = {name.removesuffix(".json").replace("-", "_"): kit.read_json(p / name) for name in RUN_FILES}
    texts = {name: (p / name).read_text(encoding="utf-8") for name in RUN_TEXTS if (p / name).exists()}
    folders = sorted(x.name for x in p.iterdir() if x.is_dir())
    return {"id": run_id, "data": data, "texts": texts, "folders": folders,
            "stages": _stage_rows(data["progress"] or {}), "running": engine.is_running(run_id),
            "pending": interactions.list(run_id), "results_ready": (p / "results.xlsx").exists()}


@router.post("/runs/{run_id}/start")
def start_run(run_id: str):
    _run_or_404(run_id)
    try:
        engine.start(run_id)
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from None
    return {"running": True}


@router.post("/runs/{run_id}/stop")
def stop_run(run_id: str):
    engine.stop(run_id)
    return {"running": False}


class RetryIn(BaseModel):
    stage: str


@router.post("/runs/{run_id}/retry")
async def retry_stage(run_id: str, body: RetryIn):
    """Mark a failed or waiting stage as not started, then resume the run from it."""
    _run_or_404(run_id)
    if engine.is_running(run_id):
        raise HTTPException(409, "The run is running.")
    r = await kit.run_script("progress", "stage", f"runs/{run_id}", body.stage, "started", "--note", "retried by the person")
    _err(r)
    engine.start(run_id)
    return {"running": True}


@router.get("/runs/{run_id}/events", response_class=EventSourceResponse)
async def run_events(run_id: str, after: int = 0):
    _run_or_404(run_id)
    async for e in _stream(run_id, after):
        yield e


@router.get("/events/app", response_class=EventSourceResponse)
async def app_events(after: int = 0):
    async for e in _stream("app", after):
        yield e


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
    p = _run_or_404(run_id)
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
    p = _run_or_404(run_id)
    f = (p / path).resolve()
    if p.resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, "No such file in this run")
    return FileResponse(f)


@router.get("/runs/{run_id}/files")
def run_files(run_id: str, folder: str = ""):
    p = _run_or_404(run_id)
    base = (p / folder).resolve()
    if p.resolve() != base and p.resolve() not in base.parents:
        raise HTTPException(400, "Outside the run")
    return [x.relative_to(p).as_posix() for x in sorted(base.rglob("*")) if x.is_file()][:2000]


# ---------------- interactions ----------------

class AnswerIn(BaseModel):
    response: Any


@router.get("/interactions")
def list_interactions(channel: str | None = None):
    return interactions.list(channel)


@router.post("/interactions/{interaction_id}")
def answer_interaction(interaction_id: str, body: AnswerIn):
    try:
        interactions.answer(interaction_id, body.response)
    except KeyError:
        raise HTTPException(404, "This question was already answered or is no longer open.") from None
    return {"ok": True}


# ---------------- sign-off ----------------

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
    _run_or_404(run_id)
    args = [f"runs/{run_id}", "--unit", body.unit, "--decision", body.decision, "--by", body.by]
    if body.reason:
        args += ["--reason", body.reason]
    r = await kit.run_script("record_decision", *args)
    _err(r)
    return {"output": r.output}


@router.post("/runs/{run_id}/signoff/manual")
async def signoff_manual(run_id: str, body: ManualIn):
    _run_or_404(run_id)
    args = [f"runs/{run_id}", "--manual", body.test_id, "--result", body.result, "--by", body.by]
    if body.note:
        args += ["--note", body.note]
    if body.evidence:
        args += ["--evidence", body.evidence]
    r = await kit.run_script("record_decision", *args)
    _err(r)
    return {"output": r.output}


@router.post("/runs/{run_id}/signoff/complete")
async def signoff_complete(run_id: str):
    _run_or_404(run_id)
    r = await kit.run_script("record_decision", f"runs/{run_id}", "--complete")
    _err(r)
    pending = [i for i in interactions.list(run_id) if i["kind"] == "signoff"]
    if pending:
        interactions.answer(pending[0]["id"], "sign-off closed")
    elif not engine.is_running(run_id):
        engine.start(run_id)                      # resumes the sign-off stage, which writes the results
    return {"output": r.output}


@router.get("/runs/{run_id}/clarified.xlsx")
def clarified_excel(run_id: str):
    """The run's cases as clarified, in the agreed template: the author pastes them back into their Excel,
    so the answers are not asked again next time (REVIEW.md 2.10 b)."""
    p = _run_or_404(run_id)
    cases = kit.read_json(p / "cases.json", []) or []
    if not cases:
        raise HTTPException(404, "The Excel has not been read yet")
    import importlib.util
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
    p = _run_or_404(run_id)
    f = (p / body.path).resolve()
    if p.resolve() not in f.parents or f.suffix != ".zip" or not f.is_file():
        raise HTTPException(400, "Not a trace of this run")
    import subprocess
    cmd = subprocess.list2cmdline(["npx", "playwright", "show-trace", str(f)])
    subprocess.Popen(cmd, cwd=kit.KIT_DIR, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"opened": True}


@router.get("/runs/{run_id}/results.xlsx")
def results_file(run_id: str):
    p = _run_or_404(run_id) / "results.xlsx"
    if not p.exists():
        raise HTTPException(404, "results.xlsx is not written yet")
    return FileResponse(p, filename=f"results-{run_id}.xlsx")


# ---------------- feature switches ----------------

@router.get("/features")
def get_features():
    f = kit.features_module()
    items, off = f.load_items(), f.load_off()
    on = f.effective_on(items, off)
    out = []
    for i, it in items.items():
        out.append({**it, "on": i in on, "switched_off": i in off,
                    "required_by": [d for d, x in items.items() if i in x["requires"]],
                    "soft_by": [{"id": d, "loss": s["loss"]} for d, x in items.items() for s in x["soft"] if s["id"] == i],
                    "needs_all": f.needs_closure(items, i),
                    "blocked_by": [r for r in f.needs_closure(items, i) if r not in on] if f.built(it) else []})
    switched_off = {i for i in items if f.built(items[i]) and i not in on}
    losses = [{"who": w, "dep": d, "loss": loss} for w, d, loss in f.soft_losses(items, on, switched_off)]
    return {"items": out, "losses": losses, "problems": f.problems(items, off)}


class SwitchIn(BaseModel):
    id: str
    action: str           # off | on
    apply: bool = False


@router.post("/features/switch")
def switch_feature(body: SwitchIn):
    f = kit.features_module()
    items, off = f.load_items(), f.load_off()
    if body.id not in items:
        raise HTTPException(404, "Unknown part")
    it, on = items[body.id], f.effective_on(items, off)
    if body.action == "off":
        if it["core"]:
            return {"allowed": False, "reason": f"It is core: {it.get('core_reason') or 'the flow does not work without it.'}"}
        cascade = [d for d in f.dependents_closure(items, body.id) if d in on]
        blocked = [d for d in cascade if items[d]["core"]]
        if blocked:
            return {"allowed": False, "reason": "Core parts need it: " + ", ".join(items[b]["name"] for b in blocked)}
        gone = {body.id, *cascade}
        losses = [{"who": w, "dep": d, "loss": line} for w, d, line in f.soft_losses(items, on - gone, gone)]
        if body.apply:
            f.save_off(items, off | gone)
        return {"allowed": True, "also": cascade, "losses": losses, "applied": body.apply}
    if body.action == "on":
        if not f.built(it):
            return {"allowed": False, "reason": f"It is {it['status']} (not built)."}
        needed = [r for r in f.needs_closure(items, body.id) if r not in on]
        if any(not f.built(items[r]) for r in needed):
            return {"allowed": False, "reason": "It needs parts that are not built."}
        if body.apply:
            f.save_off(items, off - {body.id, *needed})
        return {"allowed": True, "also": needed, "losses": [], "applied": body.apply}
    raise HTTPException(400, "action is off or on")


# ---------------- setup, accounts, login ----------------

def _parse_setup(output: str) -> list[dict]:
    rows = []
    for line in output.splitlines():
        m = re.match(r"^(OK|MISSING|BROKEN|WARN|INFO)\s+(.*?)(?: {2}-> (.*))?$", line)   # check_setup puts "  -> fix"
        if m:
            rows.append({"status": m.group(1), "item": m.group(2), "fix": m.group(3) or ""})
    return rows


@router.get("/setup")
async def setup_check():
    r = await kit.run_script("check_setup")
    return {"ok": r.code == 0, "rows": _parse_setup(r.output), "output": r.output}


class FixIn(BaseModel):
    id: str


@router.post("/setup/fix")
async def setup_fix(body: FixIn):
    cmd = kit.FIX_COMMANDS.get(body.id)
    if not cmd:
        raise HTTPException(400, "Unknown fix")
    bus.emit("app", "script_start", stage="setup", script=" ".join(cmd))
    r = await kit.run_command(cmd, on_line=lambda line: bus.emit("app", "script_line", stage="setup", text=line))
    bus.emit("app", "script_end", stage="setup", code=r.code, text=r.output[-3000:])
    return {"code": r.code, "output": r.output[-6000:]}


def _env_path() -> Path:
    return kit.KIT_DIR / ".env"


def _env_values() -> dict[str, str]:
    out = {}
    p = _env_path()
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                out[m.group(1)] = m.group(2).strip('"').strip("'")
    return out


@router.get("/env")
def get_env():
    values = _env_values()
    accounts = [{"name": a, "user_set": bool(values.get(f"{a}_USER")), "password_set": bool(values.get(f"{a}_PASSWORD"))}
                for a in kit.env_example_accounts()]
    return {"env_exists": _env_path().exists(), "start_page": values.get("START_PAGE", ""), "accounts": accounts,
            "allowed_origins": kit.guardrails().get("allowed_origins", [])}


class EnvIn(BaseModel):
    key: str
    value: str


@router.put("/env")
def put_env(body: EnvIn):
    """Write one value into .env. Values are never sent back (except START_PAGE)."""
    accounts = kit.env_example_accounts()
    allowed = {"START_PAGE", "UAT_SESSION_MAX_AGE_MIN"} | {f"{a}_{s}" for a in accounts for s in ("USER", "PASSWORD")}
    if body.key not in allowed:
        raise HTTPException(400, "Unknown setting")
    if "\n" in body.value or "\r" in body.value:
        raise HTTPException(400, "One line only")
    p = _env_path()
    lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
    for n, line in enumerate(lines):
        if re.match(rf"^\s*{body.key}\s*=", line):
            lines[n] = f"{body.key}={body.value}"
            break
    else:
        lines.append(f"{body.key}={body.value}")
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"ok": True}


class AccountIn(BaseModel):
    label: str


@router.post("/env/accounts")
def add_account(body: AccountIn):
    key = re.sub(r"[^A-Z0-9]+", "_", body.label.upper()).strip("_")
    if not key:
        raise HTTPException(400, "Give the account a name, e.g. Manager test account")
    p = kit.KIT_DIR / ".env.example"
    text = p.read_text(encoding="utf-8") if p.exists() else ""
    if f"{key}_USER=" not in text:
        text = text.rstrip() + f"\n{key}_USER=\n{key}_PASSWORD=\n"
        p.write_text(text, encoding="utf-8")
    return {"key": key}


class OriginsIn(BaseModel):
    origins: list[str]


@router.put("/guardrails/origins")
def put_origins(body: OriginsIn):
    p = kit.KIT_DIR / "config" / "guardrails.yaml"
    text = p.read_text(encoding="utf-8")
    origins = [o.rstrip("/") for o in body.origins if re.match(r"^https?://[^/\s]+$", o.rstrip("/"))]
    if not origins:
        raise HTTPException(400, "Give at least one site as scheme and host, e.g. https://test.app.example.com")
    block = "allowed_origins:" + "".join(f"\n  - {o}" for o in origins)
    text = re.sub(r"^allowed_origins:.*?(?=^\S)", block + "\n\n", text, count=1, flags=re.S | re.M)
    yaml.safe_load(text)
    p.write_text(text, encoding="utf-8")
    return kit.guardrails().get("allowed_origins", [])


login_task: dict[str, asyncio.Task] = {}


@router.post("/setup/login")
async def start_login_setup():
    from .pw_agents import run_login_setup
    t = login_task.get("job")
    if t and not t.done():
        raise HTTPException(409, "Login setup is already running.")

    async def job():
        try:
            o = await run_login_setup("app")
            bus.emit("app", "note", stage="setup-login", text=f"Login setup finished ({o.stopped}).")
        except MissingApiKey as e:
            bus.emit("app", "agent_error", stage="setup-login", text=str(e))
        except Exception as e:  # noqa: BLE001
            bus.emit("app", "agent_error", stage="setup-login", text=f"Login setup failed: {e}")

    login_task["job"] = asyncio.create_task(job())
    return {"started": True}


@router.post("/setup/check-login")
async def check_login():
    r = await kit.run_script("check_login", "--all", timeout=900)
    return {"code": r.code, "output": r.output}


# ---------------- kit knowledge, config, tests, templates ----------------

@router.get("/kit/glossary")
def get_glossary():
    p = kit.KIT_DIR / "GLOSSARY.md"
    return {"text": p.read_text(encoding="utf-8") if p.exists() else ""}


class TextIn(BaseModel):
    text: str


@router.put("/kit/glossary")
def put_glossary(body: TextIn):
    (kit.KIT_DIR / "GLOSSARY.md").write_text(body.text, encoding="utf-8")
    return {"ok": True}


@router.get("/kit/app-map")
def get_app_map():
    p = kit.KIT_DIR / "app-map" / "app-map.yaml"
    text = p.read_text(encoding="utf-8") if p.exists() else ""
    return {"text": text, "data": yaml.safe_load(text) if text else None}


EDITABLE = ["guardrails.yaml", "strictness.yaml", "signoff.yaml", "screen-compare.yaml", "console-noise.yaml",
            "test-check-rules.yaml", "excel-template.yaml", "workflow.yaml"]


@router.get("/kit/config")
def list_config():
    return [{"name": n, "exists": (kit.KIT_DIR / "config" / n).exists()} for n in EDITABLE]


@router.get("/kit/config/{name}")
def get_config(name: str):
    if name not in EDITABLE + ["features.yaml", "profile.yaml"]:
        raise HTTPException(404, "Not a config file")
    return {"name": name, "text": (kit.KIT_DIR / "config" / name).read_text(encoding="utf-8"),
            "editable": name in EDITABLE}


@router.put("/kit/config/{name}")
def put_config(name: str, body: TextIn):
    if name not in EDITABLE:
        raise HTTPException(400, "This file is changed through the app's own pages, not edited directly.")
    try:
        yaml.safe_load(body.text)
    except yaml.YAMLError as e:
        raise HTTPException(400, f"Not valid YAML: {e}") from None
    (kit.KIT_DIR / "config" / name).write_text(body.text, encoding="utf-8")
    return {"ok": True}


class NoiseIn(BaseModel):
    kind: str            # console | network
    pattern: str
    reason: str
    status: list[int] = []


@router.post("/kit/console-noise")
def add_console_noise(body: NoiseIn):
    """A person accepts a console message or failed request as known, harmless noise (decision 31)."""
    if body.kind not in ("console", "network") or not body.pattern.strip() or not body.reason.strip():
        raise HTTPException(400, "Give the kind (console or network), the text to match and why it is harmless.")
    path = kit.KIT_DIR / "config" / "console-noise.yaml"
    text = path.read_text(encoding="utf-8")
    header = "".join(line + "\n" for line in text.splitlines() if line.startswith("#"))
    data = yaml.safe_load(text) or {}
    entry = {"pattern": body.pattern.strip()} if body.kind == "console" else {"url_pattern": body.pattern.strip()}
    if body.kind == "network" and body.status:
        entry["status"] = body.status
    entry["reason"] = body.reason.strip()
    data.setdefault(body.kind, [])
    if not isinstance(data[body.kind], list):
        data[body.kind] = []
    data[body.kind].append(entry)
    path.write_text(header + "\n" + yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return {"ok": True, "entries": len(data[body.kind])}


@router.get("/kit/tests")
def list_tests():
    out = []
    for p in sorted((kit.KIT_DIR / "tests").rglob("*.ts")):
        rel = p.relative_to(kit.KIT_DIR).as_posix()
        out.append({"path": rel, "removed": "_removed" in p.parts, "generated": p.name.endswith(".spec.ts") and
                    p.parent.name not in ("tests",) and "seeds" not in p.parts, "size": p.stat().st_size})
    return out


@router.get("/kit/file")
def kit_file(path: str):
    try:
        p = kit.safe_kit_path(path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    if not p.is_file():
        raise HTTPException(404, "No such file")
    return FileResponse(p)


@router.get("/kit/text")
def kit_text(path: str):
    try:
        p = kit.safe_kit_path(path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    if not p.is_file():
        raise HTTPException(404, "No such file")
    return {"path": path, "text": p.read_text(encoding="utf-8", errors="replace")}


@router.get("/kit/template")
def template():
    return FileResponse(kit.KIT_DIR / "templates" / "uat-test-cases.xlsx", filename="uat-test-cases.xlsx")


@router.get("/kit/examples")
def examples():
    return [p.name for p in sorted((kit.KIT_DIR / "examples").glob("*.xlsx"))]


@router.get("/kit/examples/{name}")
def example(name: str):
    p = (kit.KIT_DIR / "examples" / name).resolve()
    if p.parent != (kit.KIT_DIR / "examples").resolve() or not p.exists():
        raise HTTPException(404, "No such example")
    return FileResponse(p, filename=name)


@router.get("/kit/agents")
def kit_agents():
    from .mcp_bridge import load_agent_file
    out = []
    for p in sorted((kit.KIT_DIR / ".github" / "agents").glob("*.agent.md")):
        meta, body = load_agent_file(p.name.removesuffix(".agent.md"))
        out.append({"name": meta.get("name", p.stem), "description": meta.get("description", ""),
                    "tools": meta.get("tools", []), "body": body})
    return out


@router.get("/kit/skills")
def kit_skills():
    out = []
    for d in sorted((kit.KIT_DIR / ".github" / "skills").iterdir()):
        if (d / "SKILL.md").exists():
            text = (d / "SKILL.md").read_text(encoding="utf-8")
            m = re.search(r"^description:\s*(.*)$", text, re.M)
            out.append({"name": d.name, "description": m.group(1) if m else "", "text": text,
                        "on": kit.is_on(f"skill-{d.name}"),
                        "files": [p.relative_to(d).as_posix() for p in d.rglob("*")
                                  if p.is_file() and "__pycache__" not in p.parts]})
    return out


@router.post("/kit/selftest")
async def selftest():
    r = await kit.run_script("selftest", timeout=1800)
    return {"code": r.code, "output": r.output[-12000:]}


@router.post("/kit/features-check")
async def features_check():
    r = await kit.run_script("features", "check")
    return {"code": r.code, "output": r.output}


@router.get("/usage")
def usage():
    rows = []
    for rid in kit.list_runs():
        for u in kit.read_json(kit.run_path(rid) / "usage.json", []) or []:
            rows.append({"run": rid, **u})
    totals: dict[str, dict] = {}
    for u in rows:
        t = totals.setdefault(u["model"], {"model": u["model"], "input": 0, "output": 0, "calls": 0})
        t["input"] += u["input_tokens"]
        t["output"] += u["output_tokens"]
        t["calls"] += 1
    return {"rows": rows[-500:], "totals": list(totals.values())}
