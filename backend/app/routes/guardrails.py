"""Guardrails: what the agents may never do in the browser or on this computer, as settings."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import guardrails

router = APIRouter()


@router.get("/guardrails")
def get_guardrails():
    return {"settings": guardrails.load(), "known_tools": guardrails.KNOWN_TOOLS, "always_protected": guardrails.ALWAYS_PROTECTED}


class GuardrailsIn(BaseModel):
    allowed_origins: list[str]
    blocked_tools: list[str]
    protected_files: list[str]
    never_click: list[str]
    ask_before_click_matching: list[str]
    dialogs_need_approval: bool


@router.put("/guardrails")
def put_guardrails(body: GuardrailsIn):
    try:
        return guardrails.save(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


class OriginsIn(BaseModel):
    origins: list[str]


@router.put("/guardrails/origins")
def put_origins(body: OriginsIn):
    """Only the sites (the Setup page's box); everything else stays as it is."""
    try:
        return guardrails.save({**guardrails.load(), "allowed_origins": body.origins})["allowed_origins"]
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
