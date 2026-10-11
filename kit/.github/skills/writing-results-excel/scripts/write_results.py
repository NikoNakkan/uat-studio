"""Write runs/<run-id>/results.xlsx from the run's files. Counts come from the files, never from memory.

Usage: python write_results.py runs/<run-id>
Sheets: Run (what was tested, with what, bound to which Excel), Summary, Tests, Waivers, Screens, Usage.
A sealed run (manifest.json from record_decision.py --complete) is checked first: if any sealed file
changed since, nothing is written.
Exit 0 = written, 1 = sealed files changed, 2 = missing input (run verify_evidence.py first).
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import PROGRESS_SEAL, seal_digest, sha256_file  # noqa: E402


def changed_since_seal(run):
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    changed = []
    for rel, digest in manifest["files"].items():
        p = run / rel if (run / rel).exists() or not (ROOT / rel).exists() else ROOT / rel
        if not p.exists():
            changed.append(f"{rel} (missing)")
        elif digest.startswith(PROGRESS_SEAL):
            if seal_digest(p) != digest:
                changed.append(rel)
        elif sha256_file(p) != digest:
            if not (rel == "progress.json" and results_match_sealed_check(run)):
                changed.append(rel)
    return manifest, changed


def results_match_sealed_check(run):
    """Runs sealed before the seal left out progress.json's stage bookkeeping: progress.json counts as unchanged
    when every test result in it still matches evidence-check.json, which was sealed at the same moment (and is
    itself checked above, so it cannot have been edited to match)."""
    progress = read(run / "progress.json", {})
    sealed = read(run / "evidence-check.json", {}).get("tests", {})
    results = {t: v.get("result") for t, v in (progress.get("tests") or {}).items()}
    expected = {t: v.get("result") for t, v in sealed.items() if v.get("recommendation") != "MANUAL" and v.get("result") != "not_run"}
    return bool(expected) and all(results.get(t) == r for t, r in expected.items()) and set(results) <= set(sealed)
FILLS = {"PASS": "C6EFCE", "FAIL": "FFC7CE", "CONCERNS": "FFEB9C", "WAIVED": "DDEBF7", "MANUAL": "E4DFEC",
         "passed": "C6EFCE", "failed": "FFC7CE", "timedOut": "FFC7CE", "not_run": "EDEDED",
         "manual: PASS": "C6EFCE", "manual: FAIL": "FFC7CE", "manual: NOT_RUN": "EDEDED", "manual: no result yet": "E4DFEC"}


def read(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def sheet(wb, title, header, widths):
    ws = wb.create_sheet(title)
    ws.append(header)
    for c in ws[1]:
        c.font = Font(bold=True)
    ws.freeze_panes = "A2"
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    return ws


def explain_if_empty(ws, text):
    """A sheet with only its header says why, so an empty sheet is never mistaken for missing data."""
    if ws.max_row == 1:
        ws.append([text])
        ws.cell(2, 1).font = Font(italic=True, color="666666")


def screenshots_sheet(wb, run, tests, cases):
    """One row per step screenshot, the image itself next to the step and its expected result. Tests that did
    not pass come first; manual cases have no screenshots."""
    from openpyxl.drawing.image import Image as XlImage
    ws = sheet(wb, "Screenshots", ["Test ID", "Group", "Result", "Step", "Step text", "Expected", "Screenshot"],
               [10, 14, 12, 6, 34, 34, 60])
    steps = {c["test_id"]: c for c in cases}
    order = sorted((t for t in tests if not tests[t].get("manual")),
                   key=lambda t: (tests[t].get("result") == "passed", [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", t)]))
    for tid in order:
        t = tests[tid]
        folder = run / (t.get("evidence") or "evidence") / "screenshots"
        case = steps.get(tid, {})
        for n, png in sorted(((int(m.group(1)), p) for p in folder.glob(f"{tid}-step*.png")
                              if (m := re.match(rf"{re.escape(tid)}-step(\d+)\.png$", p.name))), key=lambda x: x[0]):
            text = next((s["text"] for s in case.get("steps", []) if int(s["n"]) == n), "")
            expected = "\n".join(e["text"] for e in case.get("expected_results", []) if int(e["step"]) == n)
            rel = png.relative_to(run).as_posix()
            add(ws, [tid, t["group"], t["result"], n, text, expected, rel], (3,))
            cell = ws.cell(ws.max_row, 7)
            cell.hyperlink = rel                                              # relative to results.xlsx in the run folder
            try:
                img = XlImage(str(png))
            except Exception:  # noqa: BLE001 - one unreadable file must not cost the whole results file
                cell.value = f"{rel} (could not be read as an image)"
                continue
            scale = min(1.0, 420 / max(img.width, 1))
            img.width, img.height = int(img.width * scale), int(img.height * scale)
            ws.add_image(img, f"G{ws.max_row}")
            ws.row_dimensions[ws.max_row].height = img.height * 0.75 + 6     # pixels to points, plus a margin
    explain_if_empty(ws, "No step screenshots in this run (screenshots switched off, or no test ran).")


def add(ws, row, colour_cols=()):
    ws.append(row)
    for i in colour_cols:
        cell = ws.cell(ws.max_row, i)
        fill = FILLS.get(str(cell.value))
        if fill:
            cell.fill = PatternFill("solid", start_color=fill, end_color=fill)
    for cell in ws[ws.max_row]:
        cell.alignment = Alignment(vertical="top", wrap_text=True)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    run = Path(sys.argv[1]) if Path(sys.argv[1]).is_absolute() else ROOT / sys.argv[1]
    check = read(run / "evidence-check.json", None)
    if check is None:
        print("Missing evidence-check.json. Run the verifying-evidence skill first.")
        return 2
    signoff = read(run / "signoff.json", {"decisions": {}, "complete": False})
    decisions = signoff["decisions"]
    manual_results = signoff.get("manual", {})
    diagnoses = read(run / "diagnoses.json", {})
    progress = read(run / "progress.json", {})
    cases = read(run / "cases.json", [])
    tests, units = check["tests"], check["units"]
    manual_cases = [t for t, e in tests.items() if e.get("manual")]

    seal = None
    if (run / "manifest.json").exists():
        seal, changed = changed_since_seal(run)
        if changed:
            print(f"Refused: the sign-off was sealed on {seal['sealed_at']} but {len(changed)} file(s) changed since:")
            print("\n".join(f"  - {c}" for c in changed[:20]))
            print("Results of a sealed run must come from the sealed files. Start a new run for new results.")
            return 1

    wb = Workbook()
    wb.remove(wb.active)

    # What was tested, with what, and against which Excel: the sign-off is bound to exactly this
    ws = sheet(wb, "Run", ["What", "Value"], [28, 90])
    tools = progress.get("tools", {})
    results_counter = Counter(t["result"] for t in tests.values())
    for row in [
        ("Run", progress.get("run_id", run.name)),
        ("Created", progress.get("created", "")),
        ("Excel file", progress.get("excel", "")),
        ("Excel SHA-256", progress.get("excel_sha256", "not recorded")),
        ("Test cases in the Excel", f"{len(cases)}" + (f" ({len(manual_cases)} manual, performed by a person)" if manual_cases else "")),
        ("Sites tested", ", ".join(sorted({f"{urlparse(c['start_page']).scheme}://{urlparse(c['start_page']).netloc}"
                                           for c in cases if c.get("start_page")}))),
        ("Test accounts used", ", ".join(sorted({c["login_as"] for c in cases if c.get("login_as")})) or "none"),
        ("Strictness", progress.get("strictness", "")),
        ("Playwright", tools.get("playwright", "not recorded")),
        ("Node.js", tools.get("node", "not recorded")),
        ("Kit version (git)", tools.get("kit_git", "not recorded")),
        ("Results", ", ".join(f"{k} {v}" for k, v in sorted(results_counter.items()))),
        ("Sign-off", "complete, sealed " + seal["sealed_at"] + f" ({len(seal['files'])} files hashed in manifest.json)"
         if seal else ("complete (not sealed)" if signoff.get("complete") else "not complete")),
        ("Decided by", ", ".join(sorted({d["by"] for d in decisions.values() if d.get("by")})) or ""),
    ]:
        add(ws, list(row))

    ws = sheet(wb, "Summary", [check["sign_off_unit"].capitalize(), "Tests", "Passed", "Failed", "Not run", "Manual",
                               "AI recommendation", "Decision", "Decided by", "Date"], [22, 8, 8, 8, 9, 14, 18, 12, 20, 12])
    for key, u in units.items():
        auto = [t for t in u["tests"] if not tests[t].get("manual")]
        results = Counter(tests[t]["result"] for t in auto)
        manual = Counter(manual_results.get(t, {}).get("result", "no result") for t in u.get("manual", []))
        d = decisions.get(key, {})
        add(ws, [key, len(u["tests"]), results.get("passed", 0),
                 len(auto) - results.get("passed", 0) - results.get("not_run", 0), results.get("not_run", 0),
                 ", ".join(f"{k} {v}" for k, v in sorted(manual.items())) if manual else "",
                 u["recommendation"], d.get("decision", "not decided"), d.get("by", ""), d.get("date", "")], (7, 8))

    ws = sheet(wb, "Tests", ["Test ID", "Group", "Title", "Excel row", "Result", "AI recommendation",
                             "Why / what is missing", "Cause", "Reproduction", "Repair", "Screenshots", "Trace",
                             "Evidence folder"], [10, 14, 34, 9, 18, 18, 50, 13, 18, 12, 11, 7, 30])
    for tid, t in tests.items():
        diag = diagnoses.get(tid, {})
        if t.get("manual"):
            m = manual_results.get(tid)
            result = f"manual: {m['result']}" if m else "manual: no result yet"
            why = (f"by {m['by']} on {m['date']}" + (f"; {m['note']}" if m.get("note") else "")) if m else "; ".join(t["reasons"])
            add(ws, [tid, t["group"], t["title"], t["row"], result, t["recommendation"], why, "", "", "", "", "",
                     m.get("evidence", "") if m else ""], (5, 6))
            continue
        add(ws, [tid, t["group"], t["title"], t["row"], t["result"], t["recommendation"],
                 "; ".join(t["reasons"] + t["missing"]), diag.get("cause", ""), diag.get("reproduction", ""),
                 diag.get("repair", ""), t.get("screenshots", ""), "yes" if t.get("trace") else "no",
                 f"runs/{run.name}/{t['evidence']}" if t.get("evidence") else ""], (5, 6))

    ws = sheet(wb, "Waivers", ["Unit", "Accepted by", "Reason", "Date", "AI recommendation"], [22, 20, 60, 12, 18])
    for key, d in decisions.items():
        if d["decision"] == "WAIVED":
            add(ws, [key, d["by"], d["reason"], d["date"], d["ai_recommendation"]])
    explain_if_empty(ws, "No waivers: no group was accepted despite a problem (no decision was WAIVED).")

    ws = sheet(wb, "Screens", ["Test ID", "Step", "Changed pixels", "Last signed-off", "This run", "Difference",
                               "AI label", "AI note"], [10, 6, 10, 40, 40, 40, 12, 50])
    screens = read(run / "screens.json", {"flagged": []})
    review = read(run / "screens-review.json", {})
    for s in screens["flagged"]:
        r = review.get(s["name"], {})
        add(ws, [s["test_id"], s["step"], s.get("changed_pixels", s.get("note", "")), s["old"], s["new"], s["diff"],
                 r.get("label", ""), r.get("note", "")])
    explain_if_empty(ws, f"No screen changed since the last signed-off run ({screens['baseline_run']})." if screens.get("baseline_run")
                     else f"Nothing to compare: this is the first signed-off run, so its {len(screens.get('pairs', []))} "
                          "screenshots become the baseline for the next run.")

    screenshots_sheet(wb, run, tests, cases)

    ws = sheet(wb, "Usage", ["Stage", "Agent", "Model", "Input tokens", "Output tokens", "Source", "At"],
               [16, 28, 24, 13, 13, 11, 20])
    usage = read(run / "usage.json", [])
    for u in usage:
        add(ws, [u["stage"], u["agent"], u["model"], u["input_tokens"], u["output_tokens"], u["source"], u["at"]])
    if usage:
        per_model = {}
        for u in usage:
            m = per_model.setdefault(u["model"], [0, 0, set()])
            m[0] += u["input_tokens"]; m[1] += u["output_tokens"]; m[2].add(u["source"])
        ws.append([])
        for model, (i, o, sources) in per_model.items():
            add(ws, ["Total", "", model, i, o, "/".join(sorted(sources)), ""])

    out = run / "results.xlsx"
    wb.save(out)
    counts = Counter(t["recommendation"] for t in tests.values())
    decided = sum(1 for k in units if k in decisions)
    print(f"Wrote {out.relative_to(ROOT).as_posix() if out.is_relative_to(ROOT) else out}: {len(tests)} test case(s); "
          + ", ".join(f"{v} {counts.get(v, 0)}" for v in ("PASS", "CONCERNS", "FAIL"))
          + (f", MANUAL {counts['MANUAL']} ({sum(1 for t in manual_cases if t in manual_results)} with a recorded result)" if counts.get("MANUAL") else "")
          + f"; {decided} of {len(units)} unit(s) decided")
    return 0


if __name__ == "__main__":
    sys.exit(main())
