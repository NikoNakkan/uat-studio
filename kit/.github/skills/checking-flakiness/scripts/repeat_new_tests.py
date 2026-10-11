"""Run new, regenerated or repaired tests several times in a row before they are trusted (decision 30).

Usage: python repeat_new_tests.py runs/<run-id> [--times 3] [--files tests/a.spec.ts ...]
Without --files: the test files in generate-list.json, plus tests repaired in this run (diagnoses.json).
Evidence goes to runs/<run-id>/flakiness/, results to runs/<run-id>/flakiness.json.
Exit 0 = every test passed every time (or nothing to repeat), 1 = some did not, 2 = Playwright did not run.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from run_tests import summarise  # noqa: E402

RULES = yaml.safe_load((ROOT / "config" / "test-check-rules.yaml").read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("--times", type=int, default=RULES["flakiness"]["new_tests_must_pass"])
    parser.add_argument("--files", nargs="+")
    args = parser.parse_args()
    run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run

    files = args.files
    if not files:
        files = []
        gen = run / "generate-list.json"
        if gen.exists():
            files += [c["test_file"] for c in json.loads(gen.read_text(encoding="utf-8"))]
        diag = run / "diagnoses.json"
        if diag.exists():
            files += [d["test_file"] for d in json.loads(diag.read_text(encoding="utf-8")).values()
                      if d.get("repair") == "repaired" and d.get("test_file")]
        files = [f for f in dict.fromkeys(files) if (ROOT / f).exists()]
    if not files:
        print("No new or repaired tests to repeat.")
        return 0

    print(f"Running {len(files)} test file(s) {args.times} times each", flush=True)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "run_tests.py"), str(run), *files,
                    "--repeat-each", str(args.times), "--evidence", "flakiness", "--no-progress"], cwd=ROOT)
    results = run / "flakiness" / "results.json"
    if not results.exists():
        print("No results: Playwright did not run. See the output above.")
        return 2

    report, unstable = {}, 0
    for tid, statuses in sorted(summarise(results).items()):
        passed = statuses.count("passed")
        verdict = "stable" if passed == len(statuses) else ("failing" if passed == 0 else "unreliable")
        report[tid] = {"runs": len(statuses), "passed": passed, "verdict": verdict}
        unstable += verdict != "stable"
        print(f"{verdict.upper():<11} {tid}: passed {passed} of {len(statuses)}")
    (run / "flakiness.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    if unstable:
        print(f"{unstable} test(s) not trusted: back to the generator with the evidence in runs/{run.name}/flakiness/")
        return 1
    print("All repeated tests passed every time.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
