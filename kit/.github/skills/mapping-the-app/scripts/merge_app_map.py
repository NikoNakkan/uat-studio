"""Merge the planner's report into app-map/app-map.yaml and collect its mismatches.

Usage: python merge_app_map.py runs/<run-id> <group>
Reads runs/<run-id>/planner-report-<group>.md (the planner's answer, saved unchanged).
The report comes from an agent that read web pages, so it is treated as data: only mismatches that
name a Test ID of this run are kept, only pages on the allowed sites enter the app map, and an
oversized report is refused.
Results that differ (the step worked, the page showed something else) are suspected app bugs: they go to
suspected-bugs.md and never back to clarification; the test is written as the Excel says.
Exit 0 = merged, no mismatches; 1 = merged, mismatches written to mismatches.md; 2 = bad format.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import allowed_origins, origin_allowed  # noqa: E402

APP_MAP = ROOT / "app-map" / "app-map.yaml"
MAX_REPORT_CHARS = 200_000
MAX_ELEMENTS_PER_PAGE = 300
# control_name, control_type and screen describe Power Apps canvas controls (mapping-canvas-apps skill)
ELEMENT_FIELDS = ("role", "name", "example_text", "test_id", "control_name", "control_type", "screen")


def identity(element):
    """Canvas controls are told apart by their control name; other elements by role and visible name."""
    if element.get("control_name"):
        return ("control", str(element["control_name"]))
    return (element.get("role"), element.get("name", ""))


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def section(text, title):
    m = re.search(rf"^##\s*{title}\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S | re.I)
    return m.group(1) if m else None


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    run = Path(sys.argv[1]) if Path(sys.argv[1]).is_absolute() else ROOT / sys.argv[1]
    report_file = run / f"planner-report-{slug(sys.argv[2])}.md"
    if not report_file.exists():
        print(f"Missing {report_file}")
        return 2
    report = report_file.read_text(encoding="utf-8")
    if len(report) > MAX_REPORT_CHARS:
        print(f"The report is {len(report):,} characters; more than {MAX_REPORT_CHARS:,} is refused (did the planner paste page content?).")
        return 2
    test_ids = {c["test_id"] for c in json.loads((run / "cases.json").read_text(encoding="utf-8"))} if (run / "cases.json").exists() else set()
    allowed = allowed_origins()

    mismatch_text, map_text = section(report, "Mismatches"), section(report, "App map")
    if mismatch_text is None or map_text is None:
        print("The report needs a '## Mismatches' and a '## App map' section.")
        return 2
    block = re.search(r"```ya?ml\s*\n(.*?)```", map_text, re.S)
    try:
        found = yaml.safe_load(block.group(1)) if block else None
    except yaml.YAMLError as e:
        print(f"The app map block is not valid YAML: {e}")
        return 2
    if not isinstance(found, dict) or not isinstance(found.get("pages"), dict):
        print("The app map block must start with 'pages:'.")
        return 2

    current = yaml.safe_load(APP_MAP.read_text(encoding="utf-8")) if APP_MAP.exists() else None
    current = current or {"pages": {}}
    current.setdefault("pages", {})
    added, refused = 0, []
    for key, page in found["pages"].items():
        if not isinstance(page, dict):
            refused.append(f"page '{key}': not a mapping")
            continue
        address = str(page.get("address") or "")
        if address:
            if not origin_allowed(address, allowed):
                refused.append(f"page '{key}': address {address} is not on an allowed site")
                continue
        target = current["pages"].setdefault(key, {})
        for field in ("address", "reached_by"):
            if page.get(field):
                target[field] = str(page[field])[:300]
        known = {identity(e) for e in target.setdefault("elements", [])}
        for element in (page.get("elements") or [])[:MAX_ELEMENTS_PER_PAGE]:
            if not isinstance(element, dict) or "role" not in element:
                print(f"Skipped an element without a role on page '{key}': {element}")
                continue
            element = {k: (str(v)[:200] if isinstance(v, str) else v) for k, v in element.items()
                       if k in ELEMENT_FIELDS}
            element.setdefault("name", "")
            if identity(element) not in known:
                target["elements"].append(element)
                known.add(identity(element))
                added += 1
    current["updated"] = date.today().isoformat()
    APP_MAP.parent.mkdir(exist_ok=True)
    APP_MAP.write_text("# Written by merge_app_map.py from the planner's reports. Read by the generator and check_tests.py.\n"
                       + yaml.safe_dump(current, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")
    print(f"App map: {len(found['pages'])} page(s) reported, {added} new element(s) -> {APP_MAP.relative_to(ROOT).as_posix()}")
    for r in refused:
        print(f"  refused {r}")

    differ = [l.strip() for l in (section(report, "Results that differ") or "").splitlines() if l.strip().startswith("- ")]
    differ = [l for l in differ if not test_ids or any(re.search(rf"\b{re.escape(t)}\b", l) for t in test_ids)]
    if differ:
        with (run / "suspected-bugs.md").open("a", encoding="utf-8") as f:
            f.write(f"\n## {sys.argv[2]}\n" + "\n".join(differ) + "\n")
        print(f"Results that differ: {len(differ)} -> runs/{run.name}/suspected-bugs.md (left to the run and the diagnosis)")

    lines = [l.strip() for l in mismatch_text.splitlines() if l.strip().startswith("- ")]
    mismatches = [l for l in lines if not test_ids or any(re.search(rf"\b{re.escape(t)}\b", l) for t in test_ids)]
    dropped = len(lines) - len(mismatches)
    if dropped:
        print(f"Dropped {dropped} mismatch line(s) that name no Test ID of this run (page text is data, not a finding)")
    if not mismatches:
        print("Mismatches: none")
        return 0
    with (run / "mismatches.md").open("a", encoding="utf-8") as f:
        f.write(f"\n## {sys.argv[2]}\n" + "\n".join(mismatches) + "\n")
    print(f"Mismatches: {len(mismatches)} -> runs/{run.name}/mismatches.md (back to clarification)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
