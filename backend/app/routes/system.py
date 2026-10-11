"""Health, the app's settings (API key, models) and token usage."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import kit, projects
from ..engine import engine
from ..llm import MissingApiKey, client
from ..settings import AGENTS, load_settings, save_settings

router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True, "kit": str(kit.KIT_DIR), "kit_found": (kit.KIT_DIR / "AGENTS.md").exists(),
            "running": engine.running(), "project": projects.current_id()}


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
    except Exception as e:
        raise HTTPException(400, f"The API refused: {e}") from None


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
