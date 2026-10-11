"""Record the person's sign-off decision for one unit (group or test), a manual case's result, or close the sign-off.

Usage:
  python record_decision.py runs/<run-id> --unit <group or Test ID> --decision PASS|CONCERNS|FAIL|WAIVED
         --by "<name>" [--reason TEXT]
  python record_decision.py runs/<run-id> --manual <Test ID> --result PASS|FAIL|NOT_RUN --by "<name>"
         [--note TEXT] [--evidence "where the proof is"]
  python record_decision.py runs/<run-id> --complete
WAIVED needs --by and --reason. A manual case (Automation = manual) needs a result before --complete.
Writes runs/<run-id>/signoff.json. Exit 0 = recorded, 1 = refused, 2 = usage error.
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import seal_digest, sha256_file  # noqa: E402

SIGNOFF = yaml.safe_load((ROOT / "config" / "signoff.yaml").read_text(encoding="utf-8"))
# What the sign-off is bound to. Hashed when the sign-off closes; write_results.py refuses to write
# results for a run whose files changed afterwards.
SEALED = ["input.xlsx", "cases.json", "cases-original.json", "progress.json", "test-check.json", "diagnoses.json",
          "evidence-check.json", "console-new.json", "screens.json", "screens-review.json", "flakiness.json", "signoff.json"]


def write_manifest(run):
    files = {}
    for name in SEALED:
        if (run / name).exists():
            files[name] = seal_digest(run / name)
    for folder in run.glob("evidence*"):
        for p in sorted(folder.rglob("*")):
            if p.is_file() and p.suffix in (".png", ".zip", ".json", ".webm"):
                files[p.relative_to(run).as_posix()] = sha256_file(p)
    for p in sorted(ROOT.glob("tests/**/*.spec.ts")):
        if "_removed" not in p.parts:
            files[p.relative_to(ROOT).as_posix()] = sha256_file(p)
    manifest = {"sealed_at": date.today().isoformat(), "files": files}
    (run / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return len(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("--unit")
    parser.add_argument("--decision", choices=SIGNOFF["verdicts"])
    parser.add_argument("--by")
    parser.add_argument("--reason", default="")
    parser.add_argument("--manual", metavar="TEST_ID")
    parser.add_argument("--result", choices=SIGNOFF["manual_cases"]["results"])
    parser.add_argument("--note", default="")
    parser.add_argument("--evidence", default="")
    parser.add_argument("--complete", action="store_true")
    args = parser.parse_args()
    run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run

    check_file = run / "evidence-check.json"
    if not check_file.exists():
        print("Run verify_evidence.py first (no evidence-check.json).")
        return 1
    check = json.loads(check_file.read_text(encoding="utf-8"))
    units, tests = check["units"], check["tests"]
    manual_cases = [t for t, e in tests.items() if e.get("recommendation") == "MANUAL"]
    file = run / "signoff.json"
    signoff = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {"decisions": {}, "manual": {}, "complete": False}
    signoff.setdefault("manual", {})

    if args.complete:
        open_units = [u for u in units if u not in signoff["decisions"]]
        if open_units:
            print(f"Not every unit has a decision yet: {', '.join(open_units)}")
            return 1
        open_manual = [t for t in manual_cases if t not in signoff["manual"]]
        if open_manual and SIGNOFF["manual_cases"].get("needed_before_complete", True):
            print(f"Manual case(s) without a result yet: {', '.join(open_manual)} (record_decision.py --manual <TestID> --result ...)")
            return 1
        signoff.update(complete=True, completed_at=date.today().isoformat())
        file.write_text(json.dumps(signoff, indent=2, ensure_ascii=False), encoding="utf-8")
        n = write_manifest(run)
        print(f"Sign-off complete. {n} file(s) sealed in manifest.json. This run is now the baseline for screen comparison.")
        return 0

    if (run / "manifest.json").exists():
        print("This sign-off is already complete and sealed. Start a new run to decide again.")
        return 1

    if args.manual:
        if not (args.result and args.by):
            print("--manual needs --result and --by.")
            return 2
        if args.manual not in tests:
            print(f"Unknown Test ID '{args.manual}'.")
            return 1
        if args.manual not in manual_cases:
            print(f"{args.manual} is not a manual case (its Automation column is not 'manual'); its result comes from the run.")
            return 1
        signoff["manual"][args.manual] = {"result": args.result, "by": args.by, "note": args.note,
                                          "evidence": args.evidence, "date": date.today().isoformat()}
        file.write_text(json.dumps(signoff, indent=2, ensure_ascii=False), encoding="utf-8")
        done = sum(1 for t in manual_cases if t in signoff["manual"])
        print(f"{args.manual}: manual result {args.result} by {args.by}. {done} of {len(manual_cases)} manual case(s) recorded.")
        return 0

    if not (args.unit and args.decision and args.by):
        print("--unit, --decision and --by are required.")
        return 2
    if args.unit not in units:
        print(f"Unknown unit '{args.unit}'. Units: {', '.join(units)}")
        return 1
    if args.decision == "WAIVED" and not args.reason.strip():
        print("A waiver needs --reason: why the failure is accepted.")
        return 1
    ai = units[args.unit]["recommendation"]
    signoff["decisions"][args.unit] = {"decision": args.decision, "ai_recommendation": ai, "by": args.by,
                                       "reason": args.reason, "date": date.today().isoformat(),
                                       "differs_from_ai": args.decision != ai}
    file.write_text(json.dumps(signoff, indent=2, ensure_ascii=False), encoding="utf-8")
    note = f" (the AI recommended {ai})" if args.decision != ai else ""
    print(f"{args.unit}: {args.decision} by {args.by}{note}. {len(signoff['decisions'])} of {len(units)} unit(s) decided.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
