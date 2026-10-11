"""Check a finished run's evidence and compute the recommendation for every case (decision 21).

Usage: python verify_evidence.py runs/<run-id>
A PASS needs: the test passed, the test check found a real check for every expected result, a
screenshot for every step, and a trace. Otherwise CONCERNS, naming what is missing.
Failures are recommended from their diagnosis (config/signoff.yaml).
Writes runs/<run-id>/evidence-check.json. Exit 0 = done, 2 = missing input.
"""
import json
import sys
from collections import Counter
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import is_manual  # noqa: E402
from features import is_on  # noqa: E402

SIGNOFF = yaml.safe_load((ROOT / "config" / "signoff.yaml").read_text(encoding="utf-8"))
ORDER = ["PASS", "CONCERNS", "FAIL"]
NEED = {"test check": is_on("stage-test-check"), "screenshots": is_on("step-screenshots"), "trace": is_on("traces")}


def read(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def traces(results_file):
    """Test ID -> True when its last result has a trace file on disk."""
    found = {}

    def walk(suite):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                if t.get("results"):
                    att = t["results"][-1].get("attachments", [])
                    found[spec["title"].split(" ")[0]] = any(
                        a.get("name") == "trace" and a.get("path") and Path(a["path"]).exists() for a in att)
        for child in suite.get("suites", []):
            walk(child)

    for s in read(results_file, {}).get("suites", []):
        walk(s)
    return found


def for_failure(diag):
    cause, repro = diag.get("cause"), diag.get("reproduction")
    rules = SIGNOFF["recommendation_for_failures"]
    if cause == "app_broken":
        if not repro:
            return "CONCERNS", "app_broken, but not reproduced yet"
        return rules.get(f"app_broken + {repro}", "CONCERNS"), f"app_broken, {repro}"
    if cause in rules:
        return rules[cause], cause
    return rules["not_diagnosed"], "failure not diagnosed"


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    run = Path(sys.argv[1]) if Path(sys.argv[1]).is_absolute() else ROOT / sys.argv[1]
    if not (run / "cases.json").exists():
        print(f"Missing {run / 'cases.json'}")
        return 2
    cases = read(run / "cases.json", [])
    tests = read(run / "progress.json", {}).get("tests", {})
    checks = {v["test_id"]: v for v in read(run / "test-check.json", {"files": {}})["files"].values()}
    diagnoses = read(run / "diagnoses.json", {})
    trace_cache = {}

    out, downgraded = {}, []
    for case in cases:
        tid, t = case["test_id"], tests.get(case["test_id"])
        entry = {"group": case["group"], "title": case["title"], "row": case["row"],
                 "result": t["result"] if t else "not_run", "missing": [], "reasons": []}
        if is_manual(case):
            entry.update(result="manual", recommendation="MANUAL", manual=True)
            entry["reasons"].append("performed by a person (Automation = manual); the person records the result at sign-off")
        elif not t:
            entry["recommendation"] = "CONCERNS"
            entry["reasons"].append("not run (no test file, open questions, or the run stopped)")
        else:
            ev = run / t.get("evidence", "evidence")
            entry["evidence"] = ev.relative_to(run).as_posix()
            shots = [ev / "screenshots" / f"{tid}-step{s['n']}.png" for s in case["steps"]]
            entry["screenshots"] = f"{sum(p.exists() for p in shots)}/{len(shots)}"
            if ev not in trace_cache:
                trace_cache[ev] = traces(ev / "results.json")
            entry["trace"] = trace_cache[ev].get(tid, False)
            if t["result"] == "passed":
                # Evidence parts switched off in config/profile.yaml are not required (and the page says what is lost)
                check = checks.get(tid)
                if NEED["test check"] and not check:
                    entry["missing"].append("no test check recorded for this test")
                elif NEED["test check"] and not check["ok"]:
                    entry["missing"].append("the test check rejected this test: " + "; ".join(check["problems"][:3]))
                if NEED["screenshots"]:
                    entry["missing"] += [f"screenshot of step {s['n']}" for s, p in zip(case["steps"], shots) if not p.exists()]
                if NEED["trace"] and not entry["trace"]:
                    entry["missing"].append("trace")
                entry["recommendation"] = "CONCERNS" if entry["missing"] else "PASS"
                if entry["missing"]:
                    downgraded.append(f"{tid}: passed, but CONCERNS ({'; '.join(entry['missing'])})")
                if diagnoses.get(tid, {}).get("repair") == "repaired":
                    entry["reasons"].append("passed after an approved repair")
            else:
                diag = diagnoses.get(tid, {})
                entry["recommendation"], why = for_failure(diag)
                entry["reasons"].append(why)
                entry["cause"], entry["reproduction"] = diag.get("cause"), diag.get("reproduction")
        out[tid] = entry

    unit_key = SIGNOFF["sign_off_unit"]
    units = {}
    for tid, e in out.items():
        key = e["group"] if unit_key == "group" else tid
        u = units.setdefault(key, {"tests": [], "manual": [], "recommendation": "PASS"})
        u["tests"].append(tid)
        if e["recommendation"] == "MANUAL":                 # no evidence either way: the person decides
            u["manual"].append(tid)
            if len(u["manual"]) == len(u["tests"]):
                u["recommendation"] = "MANUAL"
            continue
        if u["recommendation"] == "MANUAL":
            u["recommendation"] = "PASS"
        if ORDER.index(e["recommendation"]) > ORDER.index(u["recommendation"]):
            u["recommendation"] = e["recommendation"]

    (run / "evidence-check.json").write_text(json.dumps({"sign_off_unit": unit_key, "tests": out, "units": units},
                                                        indent=2, ensure_ascii=False), encoding="utf-8")
    counts = Counter(e["recommendation"] for e in out.values())
    print("Per test: " + ", ".join(f"{v} {counts.get(v, 0)}" for v in ORDER)
          + (f", MANUAL {counts['MANUAL']} (the person records these results at sign-off)" if counts.get("MANUAL") else ""))
    skipped = [k for k, v in NEED.items() if not v]
    if skipped:
        print(f"Not required for PASS (switched off in config/profile.yaml): {', '.join(skipped)}")
    print(f"Per {unit_key}: " + ", ".join(f"{k} {u['recommendation']}" for k, u in units.items()))
    for d in downgraded:
        print(f"  - {d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
