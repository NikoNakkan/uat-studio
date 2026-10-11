"""Record a failure's diagnosis, reproduction outcome or repair decision in diagnoses.json.

Usage:
  python record_diagnosis.py runs/<run-id> <TestID> [--cause app_broken|test_broken|environment]
         [--summary TEXT] [--repair approved|declined|repaired|rejected_by_lock]
         [--reproduction reproduced|could_not_reproduce|already_fixed]
Exit 0 = recorded, 1 = refused, 2 = usage error.
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("test_id")
    parser.add_argument("--cause", choices=["app_broken", "test_broken", "environment"])
    parser.add_argument("--summary")
    parser.add_argument("--repair", choices=["approved", "declined", "repaired", "rejected_by_lock"])
    parser.add_argument("--reproduction", choices=["reproduced", "could_not_reproduce", "already_fixed"])
    args = parser.parse_args()
    run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run

    progress = json.loads((run / "progress.json").read_text(encoding="utf-8"))
    test = progress.get("tests", {}).get(args.test_id)
    if test is None:
        print(f"{args.test_id} has no result in progress.json")
        return 1
    file = run / "diagnoses.json"
    diagnoses = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {}
    entry = diagnoses.setdefault(args.test_id, {"test_file": test.get("file"), "error": test.get("error", "")})
    if args.repair in ("approved", "repaired") and (args.cause or entry.get("cause")) != "test_broken":
        print("Only a test labelled test_broken can be repaired.")
        return 1
    for field in ("cause", "summary", "repair", "reproduction"):
        if getattr(args, field):
            entry[field] = getattr(args, field)
    entry["updated"] = datetime.now().isoformat(timespec="seconds")
    file.write_text(json.dumps(diagnoses, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{args.test_id}: " + ", ".join(f"{k}={entry[k]}" for k in ("cause", "reproduction", "repair") if k in entry))
    return 0


if __name__ == "__main__":
    sys.exit(main())
