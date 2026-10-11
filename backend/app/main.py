"""UAT Studio: FastAPI app. Serves the API and, when built, the React app."""
from __future__ import annotations

from http.cookies import SimpleCookie

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import projects
from .api import router
from .settings import FRONTEND_DIST


class ProjectMiddleware:
    """Each request works in one project: the X-UAT-Project header if given (tools, tests), else the
    uat_project cookie the project switcher sets, else the active project. Plain ASGI, so the project stays
    set for the whole request, streaming responses included, and for any task the request starts."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        pid = headers.get("x-uat-project")
        if not pid and "cookie" in headers:
            jar = SimpleCookie()
            try:
                jar.load(headers["cookie"])
            except Exception:
                jar = SimpleCookie()
            pid = jar["uat_project"].value if "uat_project" in jar else None
        token = projects.use(pid)
        try:
            await self.app(scope, receive, send)
        finally:
            projects.reset(token)

app = FastAPI(title="UAT Studio", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(ProjectMiddleware)
app.include_router(router)

if (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (FRONTEND_DIST / path).resolve()
        if path and f.is_file() and FRONTEND_DIST.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
