"""The run's progress file: create a run, record each stage, show where a stopped run continues.

Usage:
  python scripts/progress.py new <file.xlsx> [--strictness basic|standard|strict]
  python scripts/progress.py stage runs/<run-id> <stage-id> <started|done|waiting_for_person|skipped|failed> [--note TEXT]
  python scripts/progress.py show runs/<run-id>
  python scripts/progress.py latest

Test results are added by scripts/progress-reporter.ts while tests run.
Exit 0 = ok, 1 = refused (unknown stage, missing run), 2 = usage error.
"""
import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

import yaml

from common import sha256_file, tool_versions  # noqa: E402  (same folder)
from features import is_on  # noqa: E402  (same folder)

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "runs"
STATUSES = ["started", "done", "waiting_for_person", "skipped", "failed"]


def is_run(folder):
    """A run folder was created by `progress.py new`. runs/current (Playwright's scratch folder) is not one."""
    file = folder / "progress.json"
    if not file.exists():
        return False
    try:
        return "run_id" in json.loads(file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False


def stages_list():
    return yaml.safe_load((ROOT / "config" / "workflow.yaml").read_text(encoding="utf-8"))["stages"]


def stage_ids():
    return [s["id"] for s in stages_list()]


def load(run):
    file = Path(run) / "progress.json"
    if not file.exists():
        print(f"No progress file in {run}")
        sys.exit(1)
    return file, json.loads(file.read_text(encoding="utf-8"))


def save(file, progress):
    file.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")


def cmd_new(args):
    src = Path(args.excel)
    if not src.exists():
        print(f"Excel file not found: {src}")
        return 1
    run_id = datetime.now().strftime("%Y-%m-%d-%H%M")
    run, n = RUNS / run_id, 2
    while run.exists():
        run, n = RUNS / f"{run_id}-{n}", n + 1
    run.mkdir(parents=True)
    shutil.copyfile(src, run / "input.xlsx")
    # What this run was made from and with: the sign-off is bound to exactly this (results.xlsx, Run sheet)
    save(run / "progress.json", {
        "run_id": run.name, "created": datetime.now().isoformat(timespec="seconds"),
        "excel": src.name, "excel_sha256": sha256_file(src), "strictness": args.strictness,
        "tools": tool_versions(), "stages": {}, "tests": {},
    })
    print(f"RUN {run.relative_to(ROOT).as_posix()}")
    return 0


def cmd_stage(args):
    if args.stage not in stage_ids():
        print(f"Unknown stage '{args.stage}'. Stages: {', '.join(stage_ids())}")
        return 1
    file, progress = load(args.run)
    progress.setdefault("stages", {})[args.stage] = {
        "status": args.status, "at": datetime.now().isoformat(timespec="seconds"),
        **({"note": args.note} if args.note else {}),
    }
    save(file, progress)
    print(f"{args.stage}: {args.status}")
    return 0


def cmd_show(args):
    _, progress = load(args.run)
    if "run_id" not in progress:
        print(f"{args.run} is not a run folder (no run_id): runs/current is Playwright's scratch folder.")
        return 1
    stages = progress.get("stages", {})
    nxt = None
    for stage in stages_list():
        sid, switched_on = stage["id"], is_on(stage.get("feature", ""))
        status = stages.get(sid, {}).get("status", "-" if switched_on else "off (profile)")
        note = stages.get(sid, {}).get("note", "")
        print(f"  {sid:<15} {status:<20} {note}")
        if nxt is None and switched_on and status not in ("done", "skipped"):
            nxt = sid
    tests = progress.get("tests", {})
    counts = {}
    for t in tests.values():
        counts[t["result"]] = counts.get(t["result"], 0) + 1
    print(f"Tests with a result: {len(tests)} " + (str(counts) if counts else ""))
    print(f"Next stage: {nxt or 'none (run complete)'}")
    return 0


def cmd_latest(_):
    runs = sorted(p for p in RUNS.glob("*") if is_run(p))
    if not runs:
        print("No runs yet")
        return 1
    print(runs[-1].relative_to(ROOT).as_posix())
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("new"); p.add_argument("excel"); p.add_argument("--strictness", default="standard",
                                                                       choices=["basic", "standard", "strict"])
    p = sub.add_parser("stage"); p.add_argument("run"); p.add_argument("stage"); p.add_argument("status", choices=STATUSES)
    p.add_argument("--note", default="")
    p = sub.add_parser("show"); p.add_argument("run")
    sub.add_parser("latest")
    args = parser.parse_args()
    return {"new": cmd_new, "stage": cmd_stage, "show": cmd_show, "latest": cmd_latest}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
