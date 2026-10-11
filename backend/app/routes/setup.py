"""Setting up a machine and an app: requirement checks and fixes, allowed sites, login setup, the Excel in use."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

import yaml
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from .. import accounts, kit, projects
from ..events import bus
from ..interactions import interactions
from ..llm import MissingApiKey
from ..pw_agents import run_login_setup

router = APIRouter()


def _parse_setup(output: str) -> list[dict]:
    rows = []
    for line in output.splitlines():
        m = re.match(r"^(OK|MISSING|BROKEN|WARN|INFO)\s+(.*?)(?: {2}-> (.*))?$", line)   # check_setup puts "  -> fix"
        if m:
            rows.append({"status": m.group(1), "item": m.group(2), "fix": m.group(3) or ""})
    return rows


@router.get("/setup")
async def setup_check():
    with kit.script_owner("app"):
        r = await kit.run_script("check_setup")
    return {"ok": r.code == 0, "rows": _parse_setup(r.output), "output": r.output}


class FixIn(BaseModel):
    id: str


@router.post("/setup/fix")
async def setup_fix(body: FixIn):
    cmd = kit.FIX_COMMANDS.get(body.id)
    if not cmd:
        raise HTTPException(400, "Unknown fix")
    with kit.script_owner("app"):
        bus.emit("app", "script_start", stage="setup", script=" ".join(cmd))
        r = await kit.run_command(cmd, on_line=lambda line: bus.emit("app", "script_line", stage="setup", text=line))
        bus.emit("app", "script_end", stage="setup", code=r.code, text=r.output[-3000:])
    return {"code": r.code, "output": r.output[-6000:]}


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
async def start_login_setup(file: UploadFile | None = File(None)):
    """Starts the login agent. An Excel of test cases (optional) tells it the accounts, the start page and
    what a logged-in user sees; without one it uses the newest cases Studio has read."""
    t = login_task.get(projects.current_id())
    if t and not t.done():
        raise HTTPException(409, "Login setup is already running.")
    if file is not None and file.filename:
        if not file.filename.lower().endswith(".xlsx"):
            raise HTTPException(400, "The test cases must be an .xlsx file in the template.")
        setup = kit.runs_dir() / "setup"
        setup.mkdir(parents=True, exist_ok=True)
        (setup / "requirements.xlsx").write_bytes(await file.read())
        (setup / "requirements-name.txt").write_text(Path(file.filename).name, encoding="utf-8")
        r = await kit.run_script("read_excel", "runs/setup/requirements.xlsx", "runs/setup/cases.json")
        if r.code != 0:
            raise HTTPException(400, f"Could not read the Excel:\n{r.output}")

    async def job():
        with kit.script_owner("app"):
            try:
                o = await run_login_setup("app")
                bus.emit("app", "note", stage="setup-login", text=f"Login setup finished ({o.stopped}).")
            except MissingApiKey as e:
                bus.emit("app", "agent_error", stage="setup-login", text=str(e))
            except Exception as e:
                bus.emit("app", "agent_error", stage="setup-login", text=f"Login setup failed: {e}")

    login_task[projects.current_id()] = asyncio.create_task(job())
    return {"started": True}


@router.post("/setup/login/stop")
async def stop_login_setup():
    """Stops the login agent, the command it is running, and closes its open question."""
    interactions.cancel_channel("app")
    killed = kit.kill_owned("app")
    t = login_task.get(projects.current_id())
    was_running = bool(t and not t.done())
    if was_running:
        t.cancel()
        await asyncio.wait({t}, timeout=10)
    still = bool(t and not t.done())
    if (was_running or killed) and not still:
        bus.emit("app", "note", stage="setup-login", text="Login setup stopped.")
    return {"running": still}


@router.get("/excel/latest")
def latest_excel():
    """The Excel Studio already has (newest run's, or the one given to login setup): its name, where it came
    from and how many cases it has. A new run can reuse it, and the login agent reads it."""
    s = accounts.cases_source()
    return {"source": s["source"], "excel": s["excel"], "cases": len(s["cases"]),
            "reusable": bool(s["xlsx"] and s["xlsx"].exists()),
            "accounts": sorted({c["login_as"] for c in s["cases"] if c.get("login_as")})}


@router.get("/setup/login-source")
def login_source():
    return latest_excel()


@router.post("/setup/check-login")
async def check_login():
    with kit.script_owner("app"):
        r = await kit.run_script("check_login", "--all", timeout=900)
    return {"code": r.code, "output": r.output}
