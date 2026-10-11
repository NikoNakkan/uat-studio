"""What the kit knows: glossary, app map, config, tests, templates, agents, skills, self-tests."""
from __future__ import annotations

import re

import yaml
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import kit
from ..mcp_bridge import load_agent_file

router = APIRouter()


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
    if name not in [*EDITABLE, "features.yaml", "profile.yaml"]:
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
