"""The orchestrator, as code: walks config/workflow.yaml stage by stage, in its fixed order.

Decision 12 asked for a fixed checklist with the AI doing the steps; this is that checklist.
Every stage checks its switch (config/profile.yaml), runs the kit's scripts, hands AI work to the
right agent, stops for a person where the workflow says so, and records itself in progress.json,
so a stopped run resumes where it left off. Limits (max_generate_attempts, max_planner_rounds,
max_turns per agent) are enforced here.
"""
from __future__ import annotations

import asyncio

from . import kit, projects
from .events import bus
from .interactions import interactions
from .llm import MissingApiKey
from .stage_base import Ctx, StopRun
from .stages_prepare import PrepareStages
from .stages_test import TestStages


class Engine(PrepareStages, TestStages):
    """Runs, one task each: start, stop, and walk the workflow's stages in order (each stage is a method
    of the stage mixins, named stage_<id>)."""

    def __init__(self) -> None:
        self.tasks: dict[str, asyncio.Task] = {}

    @staticmethod
    def _key(run_id: str) -> str:
        """Runs are tracked per project: two projects may even have a run of the same name."""
        return f"{projects.current_id()}/{run_id}"

    def running(self) -> list[str]:
        """The current project's running runs."""
        prefix = f"{projects.current_id()}/"
        return [k[len(prefix):] for k, t in self.tasks.items() if k.startswith(prefix) and not t.done()]

    def is_running(self, run_id: str) -> bool:
        t = self.tasks.get(self._key(run_id))
        return bool(t and not t.done())

    def start(self, run_id: str) -> None:
        if self.is_running(run_id):
            return
        busy = self.running()
        if busy:      # per project: each project tests its own system, which one run at a time shares
            raise RuntimeError(f"Run {busy[0]} is running. The UAT system is shared, so one run at a time.")
        # The task copies the current context, so the run keeps this project even when the person switches.
        self.tasks[self._key(run_id)] = asyncio.create_task(self._run(run_id))

    def forget(self, run_id: str) -> None:
        self.tasks.pop(self._key(run_id), None)

    def stop(self, run_id: str) -> None:
        interactions.cancel_channel(run_id)
        kit.kill_owned(run_id)
        t = self.tasks.get(self._key(run_id))
        if t and not t.done():
            t.cancel()

    async def stop_and_wait(self, run_id: str, timeout: float = 15) -> bool:
        """Stops the run and waits until its task has ended. False if it is still ending after `timeout`."""
        self.stop(run_id)
        t = self.tasks.get(self._key(run_id))
        if t and not t.done():
            await asyncio.wait({t}, timeout=timeout)
        return not self.is_running(run_id)

    async def _run(self, run_id: str) -> None:
        with kit.script_owner(run_id):
            await self._run_owned(run_id)

    async def _run_owned(self, run_id: str) -> None:
        c = Ctx(run_id)
        bus.emit(run_id, "run", status="running")
        try:
            for stage in c.wf["stages"]:
                sid = stage["id"]
                c.stage = sid
                status = c.progress().get("stages", {}).get(sid, {}).get("status")
                if status in ("done", "skipped"):
                    continue
                if not kit.is_on(stage.get("feature", "")):
                    await self.mark(c, sid, "skipped", "off in config/profile.yaml")
                    continue
                if not hasattr(self, f"stage_{sid}"):        # a project's older workflow (e.g. the removed console review)
                    await self.mark(c, sid, "skipped", "no longer part of the flow")
                    continue
                await self.mark(c, sid, "started")
                outcome = await getattr(self, f"stage_{sid}")(c)
                result, note = outcome if isinstance(outcome, tuple) else ("done", "")
                await self.mark(c, sid, result, note)
            bus.emit(run_id, "run", status="complete")
        except StopRun as e:
            await self.mark(c, c.stage, "failed", str(e))
            bus.emit(run_id, "run", status="stopped", reason=str(e))
        except MissingApiKey as e:
            await self.mark(c, c.stage, "waiting_for_person", str(e))
            bus.emit(run_id, "run", status="stopped", reason=str(e))
        except asyncio.CancelledError:
            bus.emit(run_id, "run", status="stopped", reason="Stopped by the person.")
            raise
        except Exception as e:
            await self.mark(c, c.stage, "failed", f"Unexpected error: {e}")
            bus.emit(run_id, "run", status="stopped", reason=f"Unexpected error in {c.stage}: {e}")


engine = Engine()
