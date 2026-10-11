"""Validate cases.json against config/excel-template.yaml before any AI sees it.

Usage: python validate.py runs/<run-id>/cases.json
Exit 0 = valid, 1 = problems (each names the Excel row and column), 2 = usage error.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import origin_allowed  # noqa: E402

TEMPLATE = yaml.safe_load((ROOT / "config" / "excel-template.yaml").read_text(encoding="utf-8"))
GUARD = yaml.safe_load((ROOT / "config" / "guardrails.yaml").read_text(encoding="utf-8"))



def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    cases = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    cols = TEMPLATE["columns"]
    header = {k: c["header"] for k, c in cols.items()}
    problems = []

    def problem(case, key, text):
        problems.append(f"Row {case['row']}, column '{header[key]}' ({case.get('test_id') or 'no Test ID'}): {text}")

    ids = [c["test_id"] for c in cases if c["test_id"]]
    for case in cases:
        for key, col in cols.items():
            if col["required"] and not case[key]:
                problem(case, key, "required, but empty")
        if case["test_id"] and ids.count(case["test_id"]) > 1:
            problem(case, "test_id", "the same Test ID is used on more than one row")
        if case["test_id"] and not re.fullmatch(r"[A-Za-z0-9_.-]+", case["test_id"]):
            problem(case, "test_id", "use only letters, digits, '-', '_' or '.' (it becomes part of a file name)")

        if case["start_page"]:
            url = urlparse(case["start_page"])
            if url.scheme not in ("http", "https") or not url.netloc:
                problem(case, "start_page", f"'{case['start_page']}' is not a full web address (https://...)")
            elif not origin_allowed(case["start_page"], GUARD["allowed_origins"]):
                problem(case, "start_page", f"{url.scheme}://{url.netloc} is not in config/guardrails.yaml allowed_origins")

        numbers = [s["n"] for s in case["steps"]]
        for s in case["steps"]:
            if s["n"] is None:
                problem(case, "steps", f"line '{s['text'][:40]}' does not start with a step number like '1.'")
        valid = [n for n in numbers if n is not None]
        if valid and valid != list(range(1, len(valid) + 1)):
            problem(case, "steps", f"steps must be numbered 1, 2, 3 ... in order (found {valid})")

        for e in case["expected_results"]:
            if e["step"] is None:
                problem(case, "expected_results", f"line '{e['text'][:40]}' does not start with the number of its step, like '3.'")
            elif e["step"] not in valid:
                problem(case, "expected_results", f"refers to step {e['step']}, which does not exist")

        for key, col in cols.items():                       # columns with a fixed list of values (Priority, Automation)
            allowed = col.get("values")
            if allowed and case.get(key) and case[key].strip().lower() not in [a.lower() for a in allowed]:
                problem(case, key, f"'{case[key]}' is not one of {', '.join(allowed)}")

    steps = sum(len(c["steps"]) for c in cases)
    manual = sum(1 for c in cases if (c.get("automation") or "").strip().lower() == "manual")
    print(f"{len(cases)} test case(s), {steps} step(s), "
          f"{sum(len(c['expected_results']) for c in cases)} expected result(s)"
          + (f", {manual} manual (performed by a person, not generated)." if manual else "."))
    if problems:
        print(f"{len(problems)} problem(s) to fix in the Excel:")
        print("\n".join(f"  - {p}" for p in problems))
        return 1
    print("Validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
