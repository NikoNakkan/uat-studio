"""Run the saved Playwright tests of a run, with no AI. Evidence goes to runs/<run-id>/.

Usage:
  python scripts/run_tests.py runs/<run-id> [test files...] [--resume] [--repeat-each N]
                              [--evidence NAME] [--no-progress] [--headed]

Without test files it runs the test file of every case in cases.json that has one.
--resume       skip cases that already have a result in progress.json
--evidence     evidence subfolder of the run. Default: the next free one of evidence, evidence-2, ...
               (Playwright empties its output folder at the start of every run, so a re-run never
               reuses an earlier folder; progress.json records which folder holds each test's evidence.)
--no-progress  do not write results to progress.json (flakiness and reproduction runs)
Exit 0 = the run completed (failures are listed, not errors), 2 = nothing could be run.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import yaml

from common import is_manual, test_file_of  # noqa: E402  (same folder)
from features import is_on  # noqa: E402  (same folder)

ROOT = Path(__file__).resolve().parents[1]


def case_files(run, resume):
    cases = json.loads((run / "cases.json").read_text(encoding="utf-8"))
    progress_file = run / "progress.json"
    done = json.loads(progress_file.read_text(encoding="utf-8")).get("tests", {}) if progress_file.exists() else {}
    files, without, manual = [], [], []
    for case in cases:
        if is_manual(case):
            manual.append(case["test_id"])
            continue
        if resume and case["test_id"] in done:
            continue
        found = test_file_of(case["test_id"])
        if found:
            files.append(found.relative_to(ROOT).as_posix())
        else:
            without.append(case["test_id"])
    return files, without, manual


def summarise(results_file):
    report = json.loads(results_file.read_text(encoding="utf-8"))
    outcome = {}

    def walk(suite):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                for r in t.get("results", []):
                    outcome.setdefault(spec["title"].split(" ")[0], []).append(r["status"])
        for child in suite.get("suites", []):
            walk(child)

    for suite in report.get("suites", []):
        walk(suite)
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("files", nargs="*")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--repeat-each", type=int, default=1)
    parser.add_argument("--evidence")
    parser.add_argument("--no-progress", action="store_true")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()

    run = (ROOT / args.run).resolve() if not Path(args.run).is_absolute() else Path(args.run)
    if not (run / "cases.json").exists():
        print(f"No cases.json in {run}. Run the intake stage first.")
        return 2

    files, without, manual = (args.files, [], []) if args.files else case_files(run, args.resume)
    set_aside = [f for f in files if "_removed" in Path(f).parts]
    if set_aside:
        print("Refused: these tests are set aside in tests/_removed/ and never run: " + ", ".join(set_aside))
        return 2
    for tid in manual:
        print(f"MANUAL   {tid} (a person performs it; result recorded at sign-off)")
    for tid in without:
        print(f"NO TEST  {tid} (no test file yet)")
    if not files:
        if args.resume:
            print("Nothing left to run: every case with a test file has a result.")
            return 0
        print("Nothing to run.")
        return 2

    masks = yaml.safe_load((ROOT / "config" / "screen-compare.yaml").read_text(encoding="utf-8")).get("masks") or []
    name, n = args.evidence or "evidence", 2
    while not args.evidence and (run / name).exists():
        name, n = f"evidence-{n}", n + 1
    evidence = run / name
    # Evidence parts switched off in config/profile.yaml (tests/fixtures.ts and playwright.config.ts read these)
    switch = lambda feature: "1" if is_on(feature) else "0"
    env = dict(os.environ, UAT_RUN_DIR=str(run), UAT_EVIDENCE_DIR=str(evidence),
               UAT_PROGRESS="0" if args.no_progress else "1", UAT_SCREEN_MASKS=json.dumps(masks),
               UAT_SHOTS=switch("step-screenshots"), UAT_CONSOLE=switch("console-capture"),
               UAT_VIDEO=switch("video-on-failure"))
    cmd = ["npx", "playwright", "test", *[f.replace("\\", "/") for f in files]]
    if not is_on("traces"):
        cmd += ["--trace", "off"]
    if args.repeat_each > 1:
        cmd += ["--repeat-each", str(args.repeat_each)]
    if args.headed:
        cmd.append("--headed")
    print("Running:", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, env=env, shell=(os.name == "nt"))

    results = evidence / "results.json"
    if not results.exists():
        print(f"Playwright produced no {results}. See the output above.")
        return 2
    outcome = summarise(results)
    for tid, statuses in sorted(outcome.items()):
        label = "PASSED" if all(s == "passed" for s in statuses) else "FAILED"
        detail = f" ({statuses.count('passed')}/{len(statuses)} passed)" if len(statuses) > 1 else ""
        print(f"{label:<8} {tid}{detail}")
    print(f"Evidence: {evidence.relative_to(ROOT).as_posix() if evidence.is_relative_to(ROOT) else evidence}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
