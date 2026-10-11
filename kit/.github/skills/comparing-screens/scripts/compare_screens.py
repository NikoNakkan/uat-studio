"""Compare each step screenshot with the same step in the last signed-off run (decision 26). Advisory only.

Usage: python compare_screens.py runs/<run-id> [--baseline <run-id>]
--baseline   compare with this run instead (a host such as UAT Studio lets the person choose it)
Masks are applied when screenshots are taken (config/screen-compare.yaml -> tests/fixtures.ts).
Writes runs/<run-id>/screens.json (pairs: every step screenshot with its status changed / unchanged / new;
flagged: the changed ones) and difference images in runs/<run-id>/screens/.
Prints "AI review: needed" when ai_review is auto and more than ai_review_threshold screens changed.
Exit 0 always (advisory), 2 = usage error.
"""
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from features import is_on  # noqa: E402

CFG =yaml.safe_load((ROOT / "config" / "screen-compare.yaml").read_text(encoding="utf-8"))
SHOT = re.compile(r"^(.+)-step(\d+)\.png$")


def rel(p):
    return p.relative_to(ROOT).as_posix() if p.is_relative_to(ROOT) else str(p)


def shots(run):
    """Screenshot name -> path, using each test's latest evidence folder."""
    progress = json.loads((run / "progress.json").read_text(encoding="utf-8")) if (run / "progress.json").exists() else {}
    found = {}
    for tid, t in progress.get("tests", {}).items():
        folder = run / t.get("evidence", "evidence") / "screenshots"
        for p in folder.glob(f"{tid}-step*.png"):
            if SHOT.match(p.name):                     # skips -r1, -r2 files from repeated runs
                found[p.name] = p
    return found


def baseline_for(run):
    older = sorted(p for p in (ROOT / "runs").glob("*") if p.name < run.name and (p / "signoff.json").exists())
    for p in reversed(older):
        if json.loads((p / "signoff.json").read_text(encoding="utf-8")).get("complete"):
            return p
    return None


def chosen_baseline(name):
    """The run the person chose to compare with; None when it has no screenshots to compare."""
    p = ROOT / "runs" / name
    return p if p.is_dir() and (p / "progress.json").exists() else None


def main():
    args = sys.argv[1:]
    chosen = None
    if len(args) == 3 and args[1] == "--baseline":
        chosen = args[2]
    elif len(args) != 1:
        print(__doc__)
        return 2
    run = Path(args[0]) if Path(args[0]).is_absolute() else ROOT / args[0]
    # pairs: every step screenshot of this run, one entry each (status changed / unchanged / new), so a person
    # can review a whole test side by side; flagged: only the changed ones (what the AI reviews).
    out = {"baseline_run": None, "compared": 0, "unchanged": 0, "flagged": [], "new_screens": [], "pairs": [],
           "ai_review": "not needed"}
    base = chosen_baseline(chosen) if chosen else baseline_for(run)
    current = shots(run)

    def pair(name, status, new_path, old_path=None, **extra):
        m = SHOT.match(name)
        out["pairs"].append({"name": name, "test_id": m.group(1), "step": int(m.group(2)), "status": status,
                             "new": rel(new_path), "old": rel(old_path) if old_path else "", **extra})

    if base is None:
        out["new_screens"] = sorted(current)
        for name, new_path in sorted(current.items()):
            pair(name, "new", new_path)
        (run / "screens.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        print(f"No baseline run {chosen}: nothing to compare." if chosen else
              f"No signed-off run yet: nothing to compare ({len(current)} screens become the baseline after sign-off).")
        print("AI review: not needed")
        return 0
    try:
        from PIL import Image, ImageChops
    except ImportError:
        out["skipped"] = "pillow not installed (pip install -r requirements.txt)"
        (run / "screens.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        print("Screen comparison skipped: pillow is not installed.")
        return 0

    old_shots = shots(base)
    out["baseline_run"] = base.name
    diff_dir = run / "screens"
    tol, limit = CFG["pixel_tolerance"], CFG["max_changed_pixels"]
    for name, new_path in sorted(current.items()):
        old_path = old_shots.get(name)
        if old_path is None:
            out["new_screens"].append(name)
            pair(name, "new", new_path)
            continue
        out["compared"] += 1
        old, new = Image.open(old_path).convert("RGB"), Image.open(new_path).convert("RGB")
        m = SHOT.match(name)
        entry = {"name": name, "test_id": m.group(1), "step": int(m.group(2)), "old": rel(old_path), "new": rel(new_path)}
        if old.size != new.size:
            entry.update(changed_ratio=1.0, note=f"size changed from {old.size} to {new.size}", diff="")
            out["flagged"].append(entry)
            pair(name, "changed", new_path, old_path, note=entry["note"], diff="")
            continue
        r, g, b = ImageChops.difference(old, new).split()
        mask = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v > tol else 0)
        changed = mask.histogram()[255]
        ratio = changed / (new.size[0] * new.size[1])
        if changed <= limit:
            out["unchanged"] += 1
            pair(name, "unchanged", new_path, old_path, changed_pixels=changed)
            continue
        diff_dir.mkdir(exist_ok=True)
        picture = Image.blend(new, Image.new("RGB", new.size, "white"), 0.6)
        picture.paste(Image.new("RGB", new.size, (220, 0, 0)), mask=mask)
        diff_path = diff_dir / name.replace(".png", "-diff.png")
        picture.save(diff_path)
        entry.update(changed_pixels=changed, changed_ratio=round(ratio, 5), diff=rel(diff_path))
        out["flagged"].append(entry)
        pair(name, "changed", new_path, old_path, changed_pixels=changed, diff=rel(diff_path))

    n = len(out["flagged"])
    if CFG.get("ai_review") == "off" or not is_on("agent-screen-reviewer"):
        out["ai_review"] = "off"
    elif n > CFG["ai_review_threshold"]:
        out["ai_review"] = "needed"
    (run / "screens.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Compared {out['compared']} screen(s) with run {base.name}: {n} changed, {out['unchanged']} unchanged, "
          f"{len(out['new_screens'])} new -> runs/{run.name}/screens.json")
    for f in out["flagged"]:
        print(f"  CHANGED {f['name']} ({f.get('note') or str(f['changed_pixels']) + ' pixels'})")
    print(f"AI review: {out['ai_review']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
