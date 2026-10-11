"""Stops for a person: questions, confirmations and approvals the flow waits for.

The engine creates an interaction and awaits it; the browser lists open interactions and answers
them. Open interactions are mirrored to runs/<run-id>/studio-pending.json. If the server restarts,
the run resumes from its progress file and asks again.
"""
from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from . import kit, projects
from .events import bus


@dataclass
class Interaction:
    id: str
    channel: str                       # run id, or "app" for setup and login work
    kind: str                          # question | change | guard | repair | setup | signoff | login | proceed
    title: str
    payload: dict[str, Any]
    created: float = field(default_factory=time.time)
    future: asyncio.Future | None = None
    project: str = field(default_factory=projects.current_id)   # whose question it is

    def public(self) -> dict:
        return {"id": self.id, "channel": self.channel, "kind": self.kind, "title": self.title,
                "payload": self.payload, "created": self.created}


class Interactions:
    def __init__(self) -> None:
        self._open: dict[str, Interaction] = {}

    def _mirror(self, channel: str) -> None:
        if channel == "app":
            return
        with contextlib.suppress(OSError, ValueError):     # a deleted run has no folder to mirror into
            kit.write_json(kit.run_path(channel) / "studio-pending.json",
                           [i.public() for i in self._mine() if i.channel == channel])

    async def ask(self, channel: str, kind: str, title: str, **payload: Any) -> Any:
        """Create an interaction and wait for the person's answer."""
        loop = asyncio.get_running_loop()
        item = Interaction(id=uuid.uuid4().hex[:12], channel=channel, kind=kind, title=title,
                           payload=payload, future=loop.create_future())
        self._open[item.id] = item
        self._mirror(channel)
        bus.emit(channel, "waiting", interaction=item.public())
        try:
            return await item.future
        finally:
            self._open.pop(item.id, None)
            self._mirror(channel)

    def answer(self, interaction_id: str, response: Any) -> Interaction:
        item = self._open.get(interaction_id)
        if item is None or item.future is None or item.future.done():
            raise KeyError(interaction_id)
        item.future.set_result(response)
        bus.emit(item.channel, "answered", interaction_id=item.id, kind=item.kind, response=response)
        return item

    def _mine(self) -> list[Interaction]:
        """Open interactions of the current project only."""
        pid = projects.current_id()
        return [i for i in self._open.values() if i.project == pid]

    def cancel_channel(self, channel: str) -> None:
        for item in self._mine():
            if item.channel == channel and item.future and not item.future.done():
                item.future.cancel()

    def list(self, channel: str | None = None) -> list[dict]:
        return [i.public() for i in self._mine() if channel is None or i.channel == channel]


interactions = Interactions()
