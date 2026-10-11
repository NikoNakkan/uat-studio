"""The stages that turn the Excel into a checked plan: preflight, intake, clarify, plan, planner check."""
from __future__ import annotations

import re

from . import agents, kit, pw_agents
from .events import bus
from .interactions import interactions
from .stage_base import Ctx, StageRunner, StopRun


class PrepareStages(StageRunner):
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
