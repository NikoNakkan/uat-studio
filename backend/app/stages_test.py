"""The stages that write, check, run and judge the tests: generate, test check, run, console review, failures,
screens, sign-off."""
from __future__ import annotations

from . import agents, kit, pw_agents
from .events import bus
from .interactions import interactions
from .llm import MissingApiKey
from .stage_base import Ctx, StageRunner, StopRun


class TestStages(StageRunner):
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
        # Resuming a stopped run skips the tests that already have a result; a retry runs them all again,
        # because the app (or the tests) may have changed since.
        resume = not c.take_retried("run") and bool(c.progress().get("tests"))
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
