"""Re-run a failed test up to N times in a fresh browser to confirm a suspected app bug (decision 20).

Usage: python reproduce.py runs/<run-id> <TestID> [--times 3]
Each try keeps its evidence in runs/<run-id>/repro/<TestID>/try<k>/. Stops at the first failure.
Records the outcome in diagnoses.json. Exit 0 = recorded, 1 = refused, 2 = could not run.
"""
import argparse
import difflib
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def first_error(results_file):
    report = json.loads(results_file.read_text(encoding="utf-8"))
    statuses, errors = [], []

    def walk(suite):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                for r in t.get("results", []):
                    statuses.append(r["status"])
                    for e in r.get("errors", []):
                        errors.append(re.sub(r"\x1b\[[0-9;]*m", "", e.get("message", "")).split("\n")[0])
        for child in suite.get("suites", []):
            walk(child)

    for s in report.get("suites", []):
        walk(s)
    return statuses, (errors[0] if errors else "")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("test_id")
    parser.add_argument("--times", type=int, default=3)
    args = parser.parse_args()
    run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run

    test = json.loads((run / "progress.json").read_text(encoding="utf-8")).get("tests", {}).get(args.test_id)
    if not test or test["result"] == "passed":
        print(f"{args.test_id} did not fail in this run; nothing to reproduce.")
        return 1
    original = test.get("error", "")

    outcome, detail = "could_not_reproduce", f"passed {args.times} of {args.times} re-runs"
    for k in range(1, args.times + 1):
        evidence = f"repro/{args.test_id}/try{k}"
        subprocess.run([sys.executable, str(ROOT / "scripts" / "run_tests.py"), str(run), test["file"],
                        "--evidence", evidence, "--no-progress"], cwd=ROOT, capture_output=True, text=True)
        results = run / evidence / "results.json"
        if not results.exists():
            print(f"Try {k}: Playwright did not run.")
            return 2
        statuses, error = first_error(results)
        if statuses and all(s == "passed" for s in statuses):
            print(f"Try {k}: passed")
            continue
        same = difflib.SequenceMatcher(None, error, original).ratio() >= 0.6
        outcome = "reproduced"
        detail = f"failed on try {k} " + ("with the same error" if same else f"with a different error: {error}")
        print(f"Try {k}: failed ({'same error' if same else 'different error'})")
        break

    file = run / "diagnoses.json"
    diagnoses = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {}
    entry = diagnoses.setdefault(args.test_id, {"test_file": test["file"], "error": original})
    entry.update(reproduction=outcome, reproduction_detail=detail, updated=datetime.now().isoformat(timespec="seconds"))
    file.write_text(json.dumps(diagnoses, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{args.test_id}: {outcome} ({detail})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
