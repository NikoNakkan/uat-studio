"""HTTP API for the React app: the route modules in app/routes, combined under /api."""
from __future__ import annotations

from fastapi import APIRouter

from .routes import accounts, features, guardrails, knowledge, live, projects, questions, runs, setup, signoff, system

router = APIRouter(prefix="/api")
for module in (system, projects, runs, live, questions, signoff, features, accounts, setup, knowledge, guardrails):
    router.include_router(module.router)
