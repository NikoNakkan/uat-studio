"""Live activity of a run: every stage, script, agent message, tool call and question.

Events are appended to runs/<run-id>/studio-events.jsonl (so a reloaded page replays the whole
story) and pushed to every open browser tab over Server-Sent Events.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from typing import Any

from . import kit

MAX_TEXT = 4000


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._seq: dict[str, int] = {}

    def _file(self, channel: str):
        if channel == "app":
            from .settings import STATE_DIR
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            return STATE_DIR / "app-events.jsonl"
        return kit.run_path(channel) / "studio-events.jsonl"

    def forget(self, channel: str) -> None:
        """A deleted run: drop its counter so a run of the same name starts again at 1."""
        self._seq.pop(channel, None)

    def _next_seq(self, channel: str) -> int:
        if channel not in self._seq:
            n = 0
            f = self._file(channel)
            if f.exists():
                with f.open(encoding="utf-8") as fh:
                    n = sum(1 for _ in fh)
            self._seq[channel] = n
        self._seq[channel] += 1
        return self._seq[channel]

    def emit(self, channel: str, type_: str, **data: Any) -> dict:
        for k, v in list(data.items()):
            if isinstance(v, str) and len(v) > MAX_TEXT:
                data[k] = v[:MAX_TEXT] + f"\n… ({len(v) - MAX_TEXT} more characters)"
        event = {"seq": self._next_seq(channel), "ts": time.time(), "type": type_, **data}
        try:
            with self._file(channel).open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        except OSError:
            pass
        for q in list(self._subs[channel]):
            q.put_nowait(event)
        return event

    def history(self, channel: str, after: int = 0) -> list[dict]:
        f = self._file(channel)
        if not f.exists():
            return []
        out = []
        with f.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if e.get("seq", 0) > after:
                    out.append(e)
        return out

    def subscribe(self, channel: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subs[channel].add(q)
        return q

    def unsubscribe(self, channel: str, q: asyncio.Queue) -> None:
        self._subs[channel].discard(q)


bus = EventBus()
