"""The flow's stops for a person: list open questions and answer them."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..interactions import interactions

router = APIRouter()


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
