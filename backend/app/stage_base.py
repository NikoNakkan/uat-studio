"""What every stage shares: the run's context (folders, state, workflow), the StopRun signal, and the helpers a
stage uses to run a kit script, mark itself in progress.json, record token usage and check an agent's outcome."""
from __future__ import annotations

import asyncio
from pathlib import Path

from . import kit
from .events import bus
from .llm import AgentOutcome


class StopRun(Exception):
    """The run stops here; the person fixes something, then resumes."""


class Ctx:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.run = kit.run_path(run_id)
        self.rel = f"runs/{run_id}"
        self.wf = kit.workflow()
        self.limits = self.wf.get("limits", {})
        self.stage = ""

    @property
    def state_file(self) -> Path:
        return self.run / "studio-state.json"

    def state(self) -> dict:
        return kit.read_json(self.state_file, {}) or {}

    def save_state(self, s: dict) -> None:
        kit.write_json(self.state_file, s)

    def progress(self) -> dict:
        return kit.read_json(self.run / "progress.json", {}) or {}

    def cases(self) -> list[dict]:
        return kit.read_json(self.run / "cases.json", []) or []

    def stage_def(self, sid: str) -> dict:
        return next((s for s in self.wf["stages"] if s["id"] == sid), {})


class StageRunner:
    """The helpers every stage uses; the stage mixins and the Engine build on it."""

    async def script(self, c: Ctx, name: str, *args: str, timeout: float | None = 900, stream: bool = False):
        bus.emit(c.run_id, "script_start", stage=c.stage, script=name, args=list(args))
        on_line = (lambda line: bus.emit(c.run_id, "script_line", stage=c.stage, script=name, text=line)) if stream else None
        try:
            r = await kit.run_script(name, *args, timeout=timeout, on_line=on_line)
        except asyncio.CancelledError:
            bus.emit(c.run_id, "script_end", stage=c.stage, script=name, code=130, text="(stopped)")
            raise
        bus.emit(c.run_id, "script_end", stage=c.stage, script=name, code=r.code, text=r.output)
        return r

    async def mark(self, c: Ctx, sid: str, status: str, note: str = "") -> None:
        args = ["stage", c.rel, sid, status] + (["--note", note[:300]] if note else [])
        await kit.run_script("progress", *args)
        bus.emit(c.run_id, "stage", stage=sid, status=status, note=note)

    async def usage(self, c: Ctx, agent: str, o: AgentOutcome) -> None:
        if kit.is_on("skill-tracking-usage") and (o.input_tokens or o.output_tokens):
            await kit.run_script("usage_report", "--run", c.rel, "--stage", c.stage, "--agent", agent, "--model", o.model,
                                 "--input-tokens", str(o.input_tokens), "--output-tokens", str(o.output_tokens))

    def check_outcome(self, o: AgentOutcome, what: str) -> None:
        if o.stopped == "error":
            raise StopRun(f"{what}: {o.text}")
