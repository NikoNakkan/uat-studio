"""Projects: list, create, switch, rename, and update a project's copy of the kit's code."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import kit, projects
from ..engine import engine

router = APIRouter()


COOKIE = "uat_project"


def _project_rows() -> list[dict]:
    current = projects.current_id()
    out = []
    for p in projects.all_projects():
        token = projects.use(p["id"])
        try:
            out.append({**p, "dir": str(projects.current_dir()), "current": p["id"] == current, "savings": projects.savings(p),
                        "runs": len(kit.list_runs()), "running": engine.running()})
        finally:
            projects.reset(token)
    return out


@router.get("/projects")
def list_projects():
    return {"current": projects.current_id(), "projects": _project_rows()}


class ProjectIn(BaseModel):
    name: str
    start_page: str


def _switch_to(pid: str) -> JSONResponse:
    """Make pid the active project, for this browser (cookie) and as the default for new tabs."""
    projects.set_active(pid)
    token = projects.use(pid)
    try:
        body = {"current": pid, "projects": _project_rows()}
    finally:
        projects.reset(token)
    r = JSONResponse(body)
    r.set_cookie(COOKIE, pid, max_age=10 * 365 * 24 * 3600, samesite="lax", httponly=False)
    return r


@router.post("/projects")
async def create_project(body: ProjectIn):
    """A new project folder next to the main kit (uat-projects/<name>), and switch to it."""
    try:
        p = await asyncio.to_thread(projects.create, body.name, body.start_page)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    r = _switch_to(p["id"])
    if p.get("note"):
        r.headers["X-UAT-Note"] = p["note"]
    return r


@router.post("/projects/{pid}/use")
def use_project(pid: str):
    if not projects.get(pid):
        raise HTTPException(404, "No such project")
    return _switch_to(pid)


class RenameIn(BaseModel):
    name: str


@router.put("/projects/{pid}")
def rename_project(pid: str, body: RenameIn):
    try:
        projects.rename(pid, body.name)
    except KeyError:
        raise HTTPException(404, "No such project") from None
    return list_projects()


class SavingsIn(BaseModel):
    hourly_rate: float | None = Field(None, ge=0, le=10_000)
    manual_hours: float = Field(projects.MANUAL_HOURS, gt=0, le=1_000)


@router.put("/projects/{pid}/savings")
def set_savings(pid: str, body: SavingsIn):
    """What a person costs per hour and how long testing this app by hand takes, to show what the runs save."""
    try:
        return projects.set_savings(pid, body.hourly_rate, body.manual_hours)
    except KeyError:
        raise HTTPException(404, "No such project") from None


@router.post("/projects/{pid}/sync")
async def sync_project(pid: str):
    """Update a project's copy of the kit's code (scripts, agents, skills, templates) from the main kit.
    Its tests, app map, runs, accounts and rules stay as they are."""
    p = projects.get(pid)
    if not p:
        raise HTTPException(404, "No such project")
    token = projects.use(pid)
    try:
        if engine.running():
            raise HTTPException(409, "A run of this project is running. Update the kit files when it has finished.")
        copied = await asyncio.to_thread(projects.sync_code, projects.current_dir())
    finally:
        projects.reset(token)
    return {"updated": copied}
