"""The orchestrator, as code: walks config/workflow.yaml stage by stage, in its fixed order.

Decision 12 asked for a fixed checklist with the AI doing the steps; this is that checklist.
Every stage checks its switch (config/profile.yaml), runs the kit's scripts, hands AI work to the
right agent, stops for a person where the workflow says so, and records itself in progress.json,
so a stopped run resumes where it left off. Limits (max_generate_attempts, max_planner_rounds,
max_turns per agent) are enforced here.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

from . import agents, kit, pw_agents
from .events import bus
from .interactions import interactions
from .llm import AgentOutcome, MissingApiKey


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


class Engine:
    def __init__(self) -> None:
        self.tasks: dict[str, asyncio.Task] = {}

    def running(self) -> list[str]:
        return [r for r, t in self.tasks.items() if not t.done()]

    def is_running(self, run_id: str) -> bool:
        t = self.tasks.get(run_id)
        return bool(t and not t.done())

    def start(self, run_id: str) -> None:
        if self.is_running(run_id):
            return
        busy = self.running()
        if busy:
            raise RuntimeError(f"Run {busy[0]} is running. The UAT system is shared, so one run at a time.")
        self.tasks[run_id] = asyncio.create_task(self._run(run_id))

    def stop(self, run_id: str) -> None:
        interactions.cancel_channel(run_id)
        t = self.tasks.get(run_id)
        if t and not t.done():
            t.cancel()

    async def stop_and_wait(self, run_id: str, timeout: float = 15) -> bool:
        """Stops the run and waits until its task has ended. False if it is still ending after `timeout`."""
        self.stop(run_id)
        t = self.tasks.get(run_id)
        if t and not t.done():
            await asyncio.wait({t}, timeout=timeout)
        return not self.is_running(run_id)

    # ---------------- helpers ----------------

    async def script(self, c: Ctx, name: str, *args: str, timeout: float | None = 900, stream: bool = False):
        bus.emit(c.run_id, "script_start", stage=c.stage, script=name, args=list(args))
        on_line = (lambda line: bus.emit(c.run_id, "script_line", stage=c.stage, script=name, text=line)) if stream else None
        r = await kit.run_script(name, *args, timeout=timeout, on_line=on_line)
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

    # ---------------- the run ----------------

    async def _run(self, run_id: str) -> None:
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
        except Exception as e:  # noqa: BLE001 - shown in the app; the run can be resumed
            await self.mark(c, c.stage, "failed", f"Unexpected error: {e}")
            bus.emit(run_id, "run", status="stopped", reason=f"Unexpected error in {c.stage}: {e}")

    # ---------------- stages ----------------

    async def stage_preflight(self, c: Ctx):
        while True:
            args = ["--run", c.rel] if (c.run / "cases.json").exists() else []
            r = await self.script(c, "check_setup", *args)
            if r.code == 0:
                return "done", "setup ready"
            answer = await interactions.ask(c.run_id, "setup", "Setup is not complete", output=r.output,
                                            options=["check again", "stop the run"])
            if answer != "check again":
                raise StopRun("Setup is not complete. Fix it on the Setup page, then resume.")

    async def stage_intake(self, c: Ctx):
        r = await self.script(c, "read_excel", f"{c.rel}/input.xlsx", f"{c.rel}/cases.json")
        if r.code != 0:
            raise StopRun("The Excel could not be read: " + r.output.splitlines()[-1] if r.output else "read failed")
        r = await self.script(c, "validate", f"{c.rel}/cases.json")
        if r.code != 0:
            kit.write_json(c.run / "studio-validation.json", {"output": r.output})
            raise StopRun("The Excel has problems to fix (see the activity). Fix the Excel and start a new run.")
        if kit.is_on("skill-detecting-test-changes"):
            r = await self.script(c, "diff_cases", c.rel)
            return "done", r.output.splitlines()[0] if r.output else ""
        return "done", "change detection is off: every case is treated as new"

    def cases_to_clarify(self, c: Ctx) -> list[str]:
        changes = kit.read_json(c.run / "changes.json", {}).get("cases", {})
        out = []
        for case in c.cases():
            if str(case.get("automation") or "").strip().lower() == "manual":
                continue
            ch = changes.get(case["test_id"])
            regenerate = ch is not None and ch.get("decision") == "regenerate" and not case.get("carried_from")
            if ch is None or ch.get("status") in ("new", "changed") or regenerate:
                out.append(case["test_id"])
        return out

    async def stage_clarify(self, c: Ctx, mismatches: str = ""):
        changes = kit.read_json(c.run / "changes.json", {}).get("cases", {})
        undecided = [t for t, e in changes.items() if e.get("decision") is None]
        to_clarify = self.cases_to_clarify(c) if not mismatches else sorted(
            {t for t in re.findall(r"\b[\w.-]+\b", mismatches) if t in {x["test_id"] for x in c.cases()}})
        if not undecided and not to_clarify:
            return "skipped", "no changed or new cases"
        o = await agents.run_clarifier(c.run_id, c.run, to_clarify, mismatches, c.stage)
        await self.usage(c, "uat-clarifier", o)
        self.check_outcome(o, "Clarification")
        r = await self.script(c, "validate", f"{c.rel}/cases.json")
        if r.code != 0:
            raise StopRun("After clarification the cases no longer pass validation (see the activity).")
        if (c.run / "questionnaire.md").exists() and any(not x.get("clarified") for x in c.cases() if x["test_id"] in to_clarify):
            answer = await interactions.ask(c.run_id, "proceed", "A questionnaire was written for the author",
                                            text=(c.run / "questionnaire.md").read_text(encoding="utf-8"),
                                            options=["answers are in: clarify again", "go on without them"])
            if answer.startswith("answers"):
                return await self.stage_clarify(c, mismatches)
        opened = [x["test_id"] for x in c.cases() if x.get("open_questions")]
        return "done", f"{len(to_clarify)} case(s) clarified" + (f"; open: {', '.join(opened)}" if opened else "")

    async def stage_plan(self, c: Ctx):
        sd = c.stage_def("plan")
        if sd.get("before_feature") and kit.is_on(sd["before_feature"]):
            r = await self.script(c, "check_login", "--run", c.rel, timeout=900)
            if r.code == 1:
                raise StopRun("A test account could not log in. Set up login on the Setup page, then resume.")
        r = await self.script(c, "excel_to_plan", c.rel)
        if r.code != 0:
            raise StopRun("Writing the plan failed (see the activity).")
        return "done", next((line for line in r.output.splitlines() if line.startswith("To generate")), "")

    def generate_list(self, c: Ctx) -> list[dict]:
        return kit.read_json(c.run / "generate-list.json", []) or []

    async def stage_planner_check(self, c: Ctx):
        state = c.state()
        while True:
            entries = self.generate_list(c)
            if not entries:
                return "skipped", "nothing to generate"
            groups: dict[str, list[dict]] = {}
            for e in entries:
                groups.setdefault(e["group"], []).append(e)
            mismatches = ""
            for group, items in groups.items():
                o = await pw_agents.run_planner(c.run_id, c.run, items, c.stage)
                await self.usage(c, pw_agents.planner_agent(items), o)
                self.check_outcome(o, "Planner check")
                report = c.run / f"planner-report-{pw_agents.slug(group)}.md"
                report.write_text(o.text, encoding="utf-8")
                r = await self.script(c, "merge_app_map", c.rel, group)
                if r.code == 2:                                   # wrong format: ask once more, format only
                    o = await pw_agents.run_planner(c.run_id, c.run, items, c.stage,
                                                    message=pw_agents.planner_message(items) +
                                                    "\n\nYour last answer was not in the format. Answer again, format only.")
                    await self.usage(c, pw_agents.planner_agent(items), o)
                    report.write_text(o.text, encoding="utf-8")
                    r = await self.script(c, "merge_app_map", c.rel, group)
                if r.code == 1:
                    mismatches += "\n" + "\n".join(line for line in o.text.splitlines() if line.strip().startswith("- "))
            if not mismatches.strip():
                return "done", f"{len(entries)} case(s) checked against the live app"
            rounds = state.get("planner_rounds", 0) + 1
            state["planner_rounds"] = rounds
            c.save_state(state)
            limit = c.limits.get("max_planner_rounds", 2)
            if rounds > limit:
                ids = {t for t in re.findall(r"\b[\w.-]+\b", mismatches) if t in {x["test_id"] for x in c.cases()}}
                cases = c.cases()
                for case in cases:
                    if case["test_id"] in ids:
                        case["open_questions"] = True
                kit.write_json(c.run / "cases.json", cases)
                await self.script(c, "excel_to_plan", c.rel)
                return "done", f"limit of {limit} planner rounds reached; not generated: {', '.join(sorted(ids))}"
            bus.emit(c.run_id, "note", stage=c.stage, text=f"Mismatches go back to clarification (round {rounds} of {limit}).")
            c.stage = "clarify"
            await self.stage_clarify(c, mismatches)
            c.stage = "plan"
            await self.stage_plan(c)
            c.stage = "planner_check"

    async def generate(self, c: Ctx, entries: list[dict], feedback: dict[str, str]) -> None:
        for e, o in await pw_agents.run_generator(c.run_id, c.run, entries, c.stage, feedback):
            await self.usage(c, "playwright-test-generator", o)
            self.check_outcome(o, f"Generating {e['test_id']}")

    async def stage_generate(self, c: Ctx):
        entries = self.generate_list(c)
        if not entries:
            return "skipped", "nothing to generate"
        await self.generate(c, entries, {})
        missing = [e["test_id"] for e in entries if not (kit.KIT_DIR / e["test_file"]).exists()]
        return "done", f"{len(entries) - len(missing)} test(s) written" + (f"; missing: {', '.join(missing)}" if missing else "")

    async def stage_test_check(self, c: Ctx):
        state = c.state()
        attempts: dict[str, int] = state.setdefault("generate_attempts", {})
        limit = c.limits.get("max_generate_attempts", 2)
        flaky_on = kit.is_on(c.stage_def("test_check").get("then_feature", ""))
        while True:
            entries = {e["test_id"]: e for e in self.generate_list(c)}
            r = await self.script(c, "check_tests", c.rel)
            report = kit.read_json(c.run / "test-check.json", {}).get("files", {})
            feedback = {v["test_id"]: "\n".join(v["problems"]) for v in report.values()
                        if not v.get("ok") and v.get("test_id") in entries}
            if r.code == 0 and flaky_on:
                fr = await self.script(c, "repeat_new_tests", c.rel, "--times", "3", timeout=3600, stream=True)
                if fr.code == 1:
                    for tid, f in (kit.read_json(c.run / "flakiness.json", {}) or {}).items():
                        if f.get("verdict") != "stable" and tid in entries:
                            feedback[tid] = (f"The test passed only {f['passed']} of {f['runs']} runs ({f['verdict']}). "
                                             "Make it reliable.")
            if not feedback:
                return "done", "every test accepted" + (" and stable" if flaky_on else "")
            retry = [entries[t] for t in feedback if attempts.get(t, 0) < limit]
            if not retry:
                return "done", f"not accepted after {limit} attempts: {', '.join(sorted(feedback))} (reported at sign-off)"
            for e in retry:
                attempts[e["test_id"]] = attempts.get(e["test_id"], 0) + 1
            c.save_state(state)
            bus.emit(c.run_id, "note", stage=c.stage, text=f"Back to the generator: {', '.join(e['test_id'] for e in retry)}")
            c.stage = "generate"
            await self.generate(c, retry, feedback)
            c.stage = "test_check"

    async def stage_run(self, c: Ctx):
        resume = bool(c.progress().get("tests"))
        args = [c.rel] + (["--resume"] if resume else [])
        r = await self.script(c, "run_tests", *args, timeout=7200, stream=True)
        if r.code == 2 and "Nothing" in r.output:
            return "done", r.output.splitlines()[-1]
        if r.code != 0:
            raise StopRun("Playwright could not run (see the activity).")
        tests = c.progress().get("tests", {})
        failed = sum(1 for t in tests.values() if t.get("result") != "passed")
        return "done", f"{len(tests)} test(s) run, {failed} failed"

    async def stage_console_review(self, c: Ctx):
        r = await self.script(c, "filter_console", c.rel)
        groups = kit.read_json(c.run / "console-new.json", {}).get("groups", [])
        if not groups:
            return "skipped", "0 new errors"
        o = await agents.run_console_analyst(c.run_id, c.run, c.stage)
        await self.usage(c, "uat-console-analyst", o)
        self.check_outcome(o, "Console review")
        return "done", r.output.splitlines()[0] if r.output else ""

    async def stage_failures(self, c: Ctx):
        tests = c.progress().get("tests", {})
        failed = [t for t, v in tests.items() if v.get("result") != "passed"]
        if not failed:
            return "skipped", "no failed tests"
        diagnoses = kit.read_json(c.run / "diagnoses.json", {}) or {}
        undiagnosed = [t for t in failed if not diagnoses.get(t, {}).get("cause")]
        if undiagnosed:
            o = await agents.run_diagnostician(c.run_id, c.run, undiagnosed, c.stage)
            await self.usage(c, "uat-diagnostician", o)
            self.check_outcome(o, "Diagnosis")
        repaired, refused = [], []
        if kit.is_on(c.stage_def("failures").get("repair_feature", "")):
            for tid, d in (kit.read_json(c.run / "diagnoses.json", {}) or {}).items():
                if d.get("cause") != "test_broken" or d.get("repair") != "approved" or not d.get("test_file"):
                    continue
                await self.script(c, "check_tests", c.rel, "--snapshot", tid)
                o = await pw_agents.run_healer(c.run_id, c.run, d["test_file"], d.get("summary", ""), c.stage)
                await self.usage(c, "playwright-test-healer", o)
                r = await self.script(c, "check_tests", c.rel, "--files", d["test_file"], "--assertion-lock")
                if r.code == 0:
                    await self.script(c, "record_diagnosis", c.rel, tid, "--repair", "repaired")
                    await self.script(c, "run_tests", c.rel, d["test_file"], timeout=1800, stream=True)
                    if kit.is_on("skill-checking-flakiness"):
                        await self.script(c, "repeat_new_tests", c.rel, "--files", d["test_file"], "--times", "3",
                                          timeout=1800, stream=True)
                    repaired.append(tid)
                else:
                    await self.script(c, "check_tests", c.rel, "--restore", tid)
                    await self.script(c, "record_diagnosis", c.rel, tid, "--repair", "rejected_by_lock")
                    refused.append(tid)
                    bus.emit(c.run_id, "finding", stage=c.stage,
                             text=f"The healer's repair of {tid} changed what the test checks; it was rejected and undone.")
        note = f"{len(failed)} failure(s) diagnosed"
        if repaired:
            note += f"; repaired: {', '.join(repaired)}"
        if refused:
            note += f"; repair rejected by the lock: {', '.join(refused)}"
        return "done", note

    async def stage_screens(self, c: Ctx):
        r = await self.script(c, "compare_screens", c.rel)
        if "AI review: needed" in r.output and kit.is_on(c.stage_def("screens").get("agent_feature", "")):
            o = await agents.run_screen_reviewer(c.run_id, c.run, c.stage)
            await self.usage(c, "uat-screen-reviewer", o)
        return "done", next((line for line in r.output.splitlines() if line.startswith(("Compared", "No signed-off"))), "")

    async def stage_signoff(self, c: Ctx):
        sealed = (c.run / "manifest.json").exists()
        if not sealed:
            r = await self.script(c, "verify_evidence", c.rel)
            if r.code != 0:
                raise StopRun("The evidence check failed (see the activity).")
            if not (c.run / "studio-reasoning.json").exists():
                try:
                    o = await agents.reporter_reasoning(c.run_id, c.run, c.stage)
                    await self.usage(c, "uat-reporter", o)
                except MissingApiKey:
                    kit.write_json(c.run / "studio-reasoning.json", {})
            await interactions.ask(c.run_id, "signoff", "Sign-off: decide each unit and record the manual cases",
                                   options=["sign-off closed"])
        r = await self.script(c, "write_results", c.rel)
        if r.code != 0:
            raise StopRun("results.xlsx was not written (see the activity).")
        return "done", "results.xlsx written"


engine = Engine()
