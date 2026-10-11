"""Compare this run's cases with the previous run: unchanged, changed, new, missing.

Usage:
  python diff_cases.py runs/<run-id> [--previous runs/<older-run>]
  python diff_cases.py runs/<run-id> --decide <TestID> <reuse|generate|regenerate|remove|keep>

Writes runs/<run-id>/changes.json and changes.md. Exit 0 = done, 1 = refused, 2 = usage error.
"""
import argparse
import difflib
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import is_manual, test_files_of  # noqa: E402

TEMPLATE = yaml.safe_load((ROOT / "config" / "excel-template.yaml").read_text(encoding="utf-8"))
FIELDS = TEMPLATE["meaning_fields"]
# generate: the case has no test yet (written for the first time); regenerate: its existing test is written again.
DECISIONS = {"changed": ["reuse", "regenerate"], "new": ["generate", "reuse"],
             "missing": ["remove", "keep"], "unchanged": ["reuse", "regenerate", "generate"]}


def text(case, field):
    value = case.get(field, "")
    if isinstance(value, list):
        return "\n".join(f"{v.get('n') or v.get('step')}. {v['text']}" for v in value)
    return str(value)


def loose(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def body(case):
    return text(case, "steps") + "\n" + text(case, "expected_results")


def has_test(test_id):
    return bool(test_files_of(test_id))          # a test set aside in tests/_removed/ does not count


def previous_run(run):
    runs = sorted(p for p in (ROOT / "runs").glob("*")
                  if (p / "cases.json").exists() and (p / "progress.json").exists() and p.resolve() != run.resolve())
    older = [p for p in runs if p.name < run.name]
    return older[-1] if older else None


def write_md(run, changes):
    s = changes["summary"]
    out = [f"# Changes since {changes['previous_run'] or 'nothing (first run)'}", "",
           f"Unchanged {s['unchanged']} · Changed {s['changed']} · New {s['new']} · Missing {s['missing']}", ""]
    for status in ("changed", "new", "missing", "unchanged"):
        items = {k: v for k, v in changes["cases"].items() if v["status"] == status}
        if not items:
            continue
        out.append(f"## {status.capitalize()} ({len(items)})")
        for tid, c in items.items():
            bits = []
            if c.get("fields_changed"):
                bits.append("fields: " + ", ".join(c["fields_changed"]))
            if c.get("wording_only_candidate"):
                bits.append("looks like wording only")
            if c.get("similar_to"):
                bits.append(f"similar to {c['similar_to']} ({c['similarity']:.0%})")
            if c.get("manual"):
                bits.append("manual (performed by a person)")
            if not c.get("has_test", True) and status == "unchanged":
                bits.append("no test file yet")
            bits.append(f"decision: {c['decision'] or 'to confirm'}")
            out.append(f"- **{tid}** {c.get('title', '')}: " + "; ".join(bits))
        out.append("")
    (run / "changes.md").write_text("\n".join(out), encoding="utf-8")


def decide(run, test_id, decision):
    file = run / "changes.json"
    if not file.exists():
        print("Run the comparison first (no changes.json).")
        return 1
    changes = json.loads(file.read_text(encoding="utf-8"))
    case = changes["cases"].get(test_id)
    if case is None:
        print(f"{test_id} is not in changes.json")
        return 1
    if case.get("decision") == "manual":
        print(f"{test_id} is a manual case (Automation column): nothing to decide, nothing is generated.")
        return 1
    if decision == "regenerate" and case["status"] == "new":
        decision = "generate"                       # a new case has no test of its own to write again
    if decision not in DECISIONS[case["status"]]:
        print(f"'{decision}' is not possible for a {case['status']} case (choose {', '.join(DECISIONS[case['status']])})")
        return 1
    case["decision"], case["confirmed_by_person"] = decision, True
    note = ""
    if decision == "remove":                    # set the test aside: kept for reference, never run
        for test in test_files_of(test_id):
            target = ROOT / "tests" / "_removed" / test.name
            target.parent.mkdir(exist_ok=True)
            test.replace(target)
            note = f" (test moved to {target.relative_to(ROOT).as_posix()})"
    file.write_text(json.dumps(changes, indent=2, ensure_ascii=False), encoding="utf-8")
    write_md(run, changes)
    print(f"{test_id}: {decision}{note}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("--previous")
    parser.add_argument("--decide", nargs=2, metavar=("TEST_ID", "DECISION"))
    args = parser.parse_args()
    run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run
    if args.decide:
        return decide(run, *args.decide)

    def load(folder, name):
        file = folder / name if (folder / name).exists() else folder / "cases.json"
        return {c["test_id"]: c for c in json.loads(file.read_text(encoding="utf-8"))}

    # Compare what the Excel said (originals), not the clarified copies
    current = load(run, "cases-original.json")
    prev_dir = (ROOT / args.previous) if args.previous else previous_run(run)
    previous = load(prev_dir, "cases-original.json") if prev_dir else {}
    clarified_before = load(prev_dir, "cases.json") if prev_dir else {}

    cases = {}
    for tid, case in current.items():
        entry = {"title": case["title"], "has_test": has_test(tid), "decision": None, "confirmed_by_person": False}
        old = previous.get(tid)
        if old is None:
            entry["status"] = "new"
            best = max(((difflib.SequenceMatcher(None, loose(body(case)), loose(body(o))).ratio(), oid)
                        for oid, o in previous.items()), default=(0, None))
            if best[0] >= 0.85:
                entry.update(similar_to=best[1], similarity=round(best[0], 3),
                             similar_is_missing=best[1] not in current)
            else:
                entry["decision"] = "generate"            # automatic: nothing similar to compare with
        else:
            changed = [f for f in FIELDS if text(case, f) != text(old, f)]
            if not changed:
                entry["status"] = "unchanged"
                # automatic: same content -> reuse its test, or generate one if there is none yet
                entry["decision"] = "reuse" if entry["has_test"] else "generate"
            else:
                entry["status"] = "changed"
                entry["fields_changed"] = changed
                entry["wording_only_candidate"] = all(loose(text(case, f)) == loose(text(old, f)) for f in changed)
        if is_manual(case):                               # a person performs it: nothing to confirm or generate
            entry["decision"], entry["manual"] = "manual", True
            entry.pop("similar_to", None)
        cases[tid] = entry
    for tid, old in previous.items():
        if tid not in current:
            cases[tid] = {"title": old["title"], "status": "missing", "has_test": has_test(tid),
                          "decision": None, "confirmed_by_person": False}

    # Unchanged cases keep last run's clarified version, so earlier answers are not lost or asked again
    working = json.loads((run / "cases.json").read_text(encoding="utf-8"))
    carried = 0
    for i, case in enumerate(working):
        before = clarified_before.get(case["test_id"])
        if cases[case["test_id"]]["status"] == "unchanged" and before:
            working[i] = {**before, "row": case["row"], "carried_from": prev_dir.name}
            carried += 1
    (run / "cases.json").write_text(json.dumps(working, indent=2, ensure_ascii=False), encoding="utf-8")

    summary = {s: sum(1 for c in cases.values() if c["status"] == s) for s in ("unchanged", "changed", "new", "missing")}
    changes = {"previous_run": prev_dir.name if prev_dir else None, "summary": summary, "cases": cases}
    (run / "changes.json").write_text(json.dumps(changes, indent=2, ensure_ascii=False), encoding="utf-8")
    write_md(run, changes)
    uncertain = [t for t, c in cases.items() if c["decision"] is None]
    print(f"Compared with {changes['previous_run'] or 'nothing (first run)'}: "
          + ", ".join(f"{k} {v}" for k, v in summary.items()))
    if carried:
        print(f"Carried {carried} unchanged case(s) over with their earlier clarifications")
    print(f"To confirm with the person: {len(uncertain)}" + (f" ({', '.join(uncertain)})" if uncertain else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
