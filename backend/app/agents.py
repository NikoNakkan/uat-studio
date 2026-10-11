"""Our agents, hosted by the app: each gets its own agent file's instructions, the skills it uses,
and only the tools its job needs. Tools that change state run the kit's scripts; tools that need a
person create an interaction and wait.
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml

from . import kit
from .agent_tools import STR, ask_person_tool, obj, read_tools, script_output, system_for, write_run_file_tool
from .interactions import interactions
from .llm import Tool, ToolResult, complete_json, run_agent
from .mcp_bridge import image_result


async def run_clarifier(channel: str, run: Path, case_ids: list[str], mismatches: str, stage: str):
    cases_file = run / "cases.json"

    async def record_answer(a: dict) -> ToolResult:
        cases = kit.read_json(cases_file, [])
        case = next((c for c in cases if c["test_id"] == a["test_id"]), None)
        if case is None:
            return ToolResult(f"No case {a['test_id']}.", is_error=True)
        patch = a.get("case_patch") or {}
        for key in ("steps", "expected_results", "preconditions", "open_questions"):
            if key in patch:
                case[key] = patch[key]
        case["clarified"] = True
        kit.write_json(cases_file, cases)
        with (run / "clarifications.md").open("a", encoding="utf-8") as f:
            f.write(f"\n## {a['test_id']}\n- Q: {a['question']} -> A: {a['answer']}\n")
        return ToolResult("Recorded and applied to cases.json.")

    async def update_glossary(a: dict) -> ToolResult:
        if not kit.is_on("skill-maintaining-glossary"):
            return ToolResult("The glossary is switched off.", is_error=True)
        g = kit.KIT_DIR / "GLOSSARY.md"
        entry = f"\n**{a['term']}**: {a['meaning']}\n" + (f"_Avoid_: {a['avoid']}.\n" if a.get("avoid") else "")
        g.write_text(g.read_text(encoding="utf-8").rstrip() + "\n" + entry, encoding="utf-8")
        return ToolResult(f"Added {a['term']} to GLOSSARY.md.")

    async def confirm_change(a: dict) -> ToolResult:
        changes = kit.read_json(run / "changes.json", {}).get("cases", {})
        entry = changes.get(a["test_id"])
        if entry is None:
            return ToolResult("No such case in changes.json.", is_error=True)
        options = {"changed": ["reuse", "regenerate"], "new": ["generate", "reuse"],
                   "missing": ["remove", "keep"], "unchanged": ["reuse", "regenerate"]}[entry["status"]]
        answer = await interactions.ask(channel, "change", f"{a['test_id']}: {entry['status']} case",
                                        test_id=a["test_id"], status=entry["status"], details=entry,
                                        suggestion=a.get("suggestion"), explanation=a.get("explanation", ""),
                                        options=options)
        r = await kit.run_script("diff_cases", f"runs/{run.name}", "--decide", a["test_id"], answer)
        return script_output(r)

    tools = [ask_person_tool(channel, "uat-clarifier"),
             Tool("record_answer", "Save one answer to clarifications.md and apply it to the case in cases.json. "
                  "case_patch may set steps [{n,text}], expected_results [{step,text}], preconditions, open_questions.",
                  obj({"test_id": STR, "question": STR, "answer": STR, "case_patch": {"type": "object"}},
                      ["test_id", "question", "answer"]), record_answer),
             Tool("update_glossary", "Add a settled term to GLOSSARY.md.",
                  obj({"term": STR, "meaning": STR, "avoid": STR}, ["term", "meaning"]), update_glossary),
             Tool("confirm_change", "Ask the person to confirm what happens to a changed, new or missing case "
                  "(your suggestion and a one-line explanation), and record their decision.",
                  obj({"test_id": STR, "suggestion": STR, "explanation": STR}, ["test_id", "suggestion"]), confirm_change),
             *read_tools(channel, run, ["GLOSSARY.md", "config/strictness.yaml", "app-map/app-map.yaml"])]
    progress = kit.read_json(run / "progress.json", {})
    planner_part = (f"\nThe planner found these mismatches in the live app; turn them into questions:\n{mismatches}\n"
                    if mismatches else "")
    prompt = (f"Run folder: runs/{run.name}. Strictness: {progress.get('strictness', 'standard')}.\n"
              f"Cases to clarify (changed or new, not manual): {', '.join(case_ids) or 'none'}.\n"
              "First confirm every case in changes.json whose decision is null (confirm_change).\n"
              "Then read cases.json and clarify the listed cases with ask_person, recording every answer.\n"
              + planner_part
              + "\nThe Excel is the requirement. Never ask whether the app or the test case is right, and never change "
              "an expected result to match what the app shows: ask only what makes a step or a result unclear.\n"
              + "\nEnd with one line per case: clarified, or open with the reason.")
    # No writing-questionnaires here: the person exports the open questions as a questionnaire from the card.
    system = system_for("uat-clarifier", ["detecting-test-changes", "grilling-test-cases", "maintaining-glossary"])
    return await run_agent(channel=channel, agent="uat-clarifier", system=system, prompt=prompt, tools=tools, stage=stage)



# ---------------- diagnostician ----------------

async def run_diagnostician(channel: str, run: Path, failed: list[str], stage: str):
    rel = f"runs/{run.name}"

    async def record(a: dict) -> ToolResult:
        args = [rel, a["test_id"]]
        for key in ("cause", "summary", "reproduction"):
            if a.get(key):
                args += [f"--{key}", a[key]]
        return script_output(await kit.run_script("record_diagnosis", *args))

    async def reproduce(a: dict) -> ToolResult:
        if not kit.is_on("skill-reproducing-failures"):
            return ToolResult("Reproduction is switched off in the profile.", is_error=True)
        return script_output(await kit.run_script("reproduce", rel, a["test_id"], "--times", "3", timeout=1800))

    async def ask_repair(a: dict) -> ToolResult:
        if not kit.is_on("repairs"):
            await kit.run_script("record_diagnosis", rel, a["test_id"], "--repair", "declined")
            return ToolResult("Repairs are switched off in the profile; recorded as declined.")
        answer = await interactions.ask(channel, "repair", f"Repair {a['test_id']}?", test_id=a["test_id"],
                                        summary=a.get("summary", ""), options=["approve", "decline"])
        decision = "approved" if answer == "approve" else "declined"
        return script_output(await kit.run_script("record_diagnosis", rel, a["test_id"], "--repair", decision))

    tools = [*read_tools(channel, run, ["config/signoff.yaml", "app-map/app-map.yaml"]),
             Tool("record_diagnosis", "Record a failure's cause (app_broken, test_broken, environment) and a short summary.",
                  obj({"test_id": STR, "cause": {"type": "string", "enum": ["app_broken", "test_broken", "environment"]},
                       "summary": STR, "reproduction": {"type": "string", "enum": ["already_fixed"]}}, ["test_id"]), record),
             Tool("reproduce", "Re-run a suspected app bug up to 3 times in a fresh browser and record the outcome.",
                  obj({"test_id": STR}), reproduce),
             Tool("ask_repair",
                  "Ask the person whether Playwright's healer may repair a test_broken test, and record the answer.",
                  obj({"test_id": STR, "summary": STR}), ask_repair),
             write_run_file_tool(run, ["diagnoses.md", "excel-updates.md"])]
    system = system_for("uat-diagnostician", ["diagnosing-failures", "reproducing-failures"])
    prompt = (f"Run folder: {rel}. Failed tests: {', '.join(failed)}.\nRead progress.json for each test's error and "
              "evidence folder, look at the last step screenshots, then diagnose, label, reproduce and ask as your "
              "instructions say. If suspected-bugs.md exists, the planner already saw these results differ from the "
              "Excel while walking the app: a hint to confirm by reproducing, not a verdict. Write diagnoses.md at the end.")
    return await run_agent(channel=channel, agent="uat-diagnostician", system=system, prompt=prompt, tools=tools, stage=stage)


# ---------------- screen reviewer ----------------

async def run_screen_reviewer(channel: str, run: Path, stage: str):
    screens = kit.read_json(run / "screens.json", {})
    flagged = {s["name"]: s for s in screens.get("flagged", [])}
    labels: dict[str, dict] = kit.read_json(run / "screens-review.json", {}) or {}

    async def view(a: dict) -> ToolResult:
        s = flagged.get(a["name"])
        if not s:
            return ToolResult("Not a flagged screen.", is_error=True)
        which = a.get("which", "new")
        rel = s.get(which) or ""
        if not rel:
            return ToolResult(f"No {which} picture ({s.get('note', '')}).", is_error=True)
        return image_result(kit.KIT_DIR / rel, f"{a['name']} ({which})")

    async def label(a: dict) -> ToolResult:
        if a["name"] not in flagged or a["label"] not in ("explained", "unexplained"):
            return ToolResult("Unknown screen or label.", is_error=True)
        labels[a["name"]] = {"label": a["label"], "note": a.get("note", "")}
        kit.write_json(run / "screens-review.json", labels)
        return ToolResult(f"Labelled {a['name']} {a['label']}. {len(labels)} of {len(flagged)} done.")

    async def changes(a: dict) -> ToolResult:
        p = run / "changes.md"
        return ToolResult(p.read_text(encoding="utf-8") if p.exists() else "(no changes.md)")

    tools = [Tool("view_screen", "Look at one flagged screen: which = old, new or diff.",
                  obj({"name": STR, "which": {"type": "string", "enum": ["old", "new", "diff"]}}), view),
             Tool("label_screen", "Label a flagged screen explained or unexplained, with one sentence.",
                  obj({"name": STR, "label": {"type": "string", "enum": ["explained", "unexplained"]}, "note": STR}), label),
             Tool("read_changes", "Read the known test case changes of this run (changes.md).", obj({}, []), changes)]
    system = system_for("uat-screen-reviewer", ["comparing-screens"])
    prompt = "Flagged screens:\n" + "\n".join(f"- {n}" for n in flagged) + "\nLabel every one."
    return await run_agent(channel=channel, agent="uat-screen-reviewer", system=system, prompt=prompt, tools=tools, stage=stage)


# ---------------- reporter (reasoning lines only; the person decides in the app) ----------------

async def reporter_reasoning(channel: str, run: Path, stage: str):
    check = kit.read_json(run / "evidence-check.json", {})
    extra = {n: (run / n).read_text(encoding="utf-8")[:6000] for n in ("diagnoses.md",) if (run / n).exists()}
    system = system_for("uat-reporter", ["verifying-evidence"])
    prompt = ("Write one line of reasoning per sign-off unit for the person deciding. Never change a recommendation. "
              "Answer only with JSON {\"<unit>\": \"<one line>\"}.\n\nevidence-check.json:\n"
              + json.dumps(check.get("units", {}), ensure_ascii=False) + "\n\nTests:\n"
              + json.dumps(check.get("tests", {}), ensure_ascii=False)[:20000]
              + "".join(f"\n\n{n}:\n{t}" for n, t in extra.items()))
    data, outcome = await complete_json(channel=channel, agent="uat-reporter", system=system, prompt=prompt, stage=stage)
    kit.write_json(run / "studio-reasoning.json", data if isinstance(data, dict) else {})
    return outcome


def yaml_dump(data) -> str:
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
