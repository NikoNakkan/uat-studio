"""Copy clarified cases into Playwright's plan layout (one plan per Group) and list what to generate.

Usage: python excel_to_plan.py runs/<run-id>
Writes specs/<group>.plan.md, runs/<run-id>/generate-list.json and, for every test account the cases
to generate log in with, a seed tests/seeds/<account>.seed.spec.ts (Playwright's agents start each
case from the seed, so the seed must be logged in as the case's account).
Exit 0 = written, 2 = usage or missing input.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import account_key, is_manual, test_file_of  # noqa: E402

_PP = ROOT / "config" / "power-platform.yaml"
POWER_PLATFORM = (yaml.safe_load(_PP.read_text(encoding="utf-8")) or {}) if _PP.exists() else {}

SEED = "tests/seed.spec.ts"
SEED_TEMPLATE = """// Seed for cases that log in as {name} ({key}). Written by excel_to_plan.py; do not edit.
// The loginAs fixture (tests/fixtures.ts) logs in with tests/login.ts; the password stays in .env.
import {{ test }} from '../fixtures';

test.use({{ loginAs: '{key}' }});

test('seed', async ({{ page }}) => {{
  await page.goto(process.env.START_PAGE ?? '/');
}});
"""


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "case"


def test_file(case):
    existing = test_file_of(case["test_id"])
    if existing:                                   # keep the same file when a title changes
        return existing.relative_to(ROOT).as_posix()
    return f"tests/{slug(case['group'])}/{case['test_id']}-{slug(case['title'])}.spec.ts"


def seed_file(case):
    if not case.get("login_as"):
        return SEED
    return f"tests/seeds/{slug(account_key(case['login_as']))}.seed.spec.ts"


def login_line(case):
    """The exact line a generated test needs so that it logs in at run time (check_tests.py verifies it)."""
    return f"test.use({{ loginAs: '{account_key(case['login_as'])}' }});" if case.get("login_as") else ""


def app_type(case):
    """'canvas' when the start page is a Power Apps canvas player (config/power-platform.yaml), else 'web'."""
    hosts = (POWER_PLATFORM.get("canvas") or {}).get("play_hosts") or []
    host = (urlparse(case.get("start_page", "")).hostname or "").lower()
    return "canvas" if host in hosts else "web"


def body(case):
    """The text the orchestrator passes to the generator inside <body>."""
    out = [f"Start page: {case['start_page']}"]
    if app_type(case) == "canvas":
        out.append("App type: Power Apps canvas app. Follow the testing-canvas-apps skill: import { test, expect } "
                   "from '../canvas-fixtures'; reach controls with canvas.control('<data-control-name>'); type with "
                   "canvas.type(...); click with canvas.click(...); after goto, canvas.waitReady(...) on a control that "
                   "only shows once the app has loaded.")
    if case.get("login_as"):
        out.append(f"Login as: {case['login_as']}. The fixture logs in; never type a user name or password. "
                   f"Put this line right after the import: {login_line(case)}")
    if case.get("preconditions"):
        out.append(f"Preconditions: {case['preconditions']}")
    out.append("Steps:")
    out += [f"{s['n']}. {s['text']}" for s in case["steps"]]
    out.append("Expected results (each belongs to the step with that number):")
    out += [f"- {e['step']}. {e['text']}" for e in case["expected_results"]]
    return "\n".join(out)


def plan_section(number, case):
    lines = [f"#### {number} {case['test_id']} {case['title']}", "",
             f"**Start page:** {case['start_page']}"]
    if case.get("login_as"):
        lines.append(f"**Login as:** {case['login_as']}")
    if case.get("preconditions"):
        lines.append(f"**Preconditions:** {case['preconditions']}")
    lines += ["", "**Steps:**"] + [f"{s['n']}. {s['text']}" for s in case["steps"]]
    lines += ["", "**Expected Results:**"] + [f"- {e['step']}. {e['text']}" for e in case["expected_results"]]
    return lines + [""]


def write_seeds(cases):
    written = []
    for case in cases:
        if not case.get("login_as"):
            continue
        target = ROOT / seed_file(case)
        content = SEED_TEMPLATE.format(name=case["login_as"], key=account_key(case["login_as"]))
        if not target.exists() or target.read_text(encoding="utf-8") != content:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            written.append(target.relative_to(ROOT).as_posix())
    return written


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    run = Path(sys.argv[1]) if Path(sys.argv[1]).is_absolute() else ROOT / sys.argv[1]
    cases_file = run / "cases.json"
    if not cases_file.exists():
        print(f"Missing {cases_file}")
        return 2
    cases = json.loads(cases_file.read_text(encoding="utf-8"))
    skipped = []
    changes_file = run / "changes.json"
    decisions = {}
    if changes_file.exists():
        decisions = {t: c.get("decision") for t, c in json.loads(changes_file.read_text(encoding="utf-8"))["cases"].items()}

    groups = {}
    for case in cases:
        if is_manual(case):                            # performed by a person: not in any plan
            skipped.append(f"{case['test_id']} (manual: a person performs it; result recorded at sign-off)")
            continue
        groups.setdefault(case["group"], []).append(case)

    specs = ROOT / "specs"
    specs.mkdir(exist_ok=True)
    to_generate = []
    for g_index, (group, items) in enumerate(groups.items(), start=1):
        plan_file = f"specs/{slug(group)}.plan.md"
        lines = [f"# {group}", "", "Generated from the UAT Excel by excel_to_plan.py. Do not edit by hand.", "",
                 "## Test Scenarios", "", f"### {g_index}. {group}", "", f"**Seed:** `{SEED}`", ""]
        for c_index, case in enumerate(items, start=1):
            number = f"{g_index}.{c_index}"
            lines += plan_section(number, case)
            decision = decisions.get(case["test_id"])
            target = test_file(case)
            if case.get("open_questions"):
                skipped.append(f"{case['test_id']} (open questions)")
            elif decision == "reuse" and (ROOT / target).exists():
                continue
            elif decision is None and changes_file.exists():
                skipped.append(f"{case['test_id']} (change not confirmed yet)")
            else:
                to_generate.append({
                    "test_id": case["test_id"], "group": group, "plan_file": plan_file, "plan_item": number,
                    "test_suite": group, "test_name": f"{case['test_id']} {case['title']}",
                    "test_file": target, "seed_file": seed_file(case), "login_line": login_line(case),
                    "app_type": app_type(case),
                    "body": body(case),
                    "reason": decision if decision and decision != "reuse" else "no test file yet",
                })
        (ROOT / plan_file).write_text("\n".join(lines), encoding="utf-8")
        print(f"Wrote {plan_file} ({len(items)} case(s))")

    for seed in write_seeds([c for c in cases if c["test_id"] in {g["test_id"] for g in to_generate}]):
        print(f"Wrote {seed} (seed logged in as that account)")
    (run / "generate-list.json").write_text(json.dumps(to_generate, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"To generate: {len(to_generate)}" + (f" ({', '.join(c['test_id'] for c in to_generate)})" if to_generate else ""))
    for s in skipped:
        print(f"Not generated: {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
