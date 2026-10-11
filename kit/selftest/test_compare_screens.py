"""comparing-screens: every step screenshot is compared with the last signed-off run and listed per test."""
import json

from PIL import Image

COMPARE = ".github/skills/comparing-screens/scripts/compare_screens.py"


def shot(kit, run, name, colour, size=(40, 30), box=None):
    """A small step screenshot; box paints a changed area (x0, y0, x1, y1) in red."""
    img = Image.new("RGB", size, colour)
    if box:
        img.paste((220, 0, 0), box)
    p = kit.path(f"{run}/evidence/screenshots/{name}")
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p)


def run_with_tests(kit, name, tests):
    run = f"runs/{name}"
    kit.write_json(f"{run}/progress.json", {"run_id": name, "stages": {},
                                            "tests": {t: {"result": "passed", "evidence": "evidence"} for t in tests}})
    return run


def test_without_a_signed_off_run_every_screen_is_new(kit):
    run = run_with_tests(kit, "2026-10-01-1000", ["TC-01"])
    shot(kit, run, "TC-01-step1.png", "white")
    r = kit.run(COMPARE, run, expect=0)
    assert "No signed-off run yet" in r.out
    data = kit.json(f"{run}/screens.json")
    assert [p["status"] for p in data["pairs"]] == ["new"] and data["pairs"][0]["test_id"] == "TC-01"


def test_pairs_list_changed_unchanged_and_new_screens_per_test(kit):
    base = run_with_tests(kit, "2026-10-01-1000", ["TC-01"])
    shot(kit, base, "TC-01-step1.png", "white")
    shot(kit, base, "TC-01-step2.png", "white")
    kit.write_json(f"{base}/signoff.json", {"decisions": {}, "complete": True})

    run = run_with_tests(kit, "2026-10-02-1000", ["TC-01", "TC-02"])
    shot(kit, run, "TC-01-step1.png", "white")                      # unchanged
    shot(kit, run, "TC-01-step2.png", "white", box=(0, 0, 20, 20))  # 400 changed pixels > 20
    shot(kit, run, "TC-02-step1.png", "white")                      # no baseline: new
    r = kit.run(COMPARE, run, expect=0)
    assert "1 changed, 1 unchanged, 1 new" in r.out

    data = kit.json(f"{run}/screens.json")
    by_name = {p["name"]: p for p in data["pairs"]}
    assert by_name["TC-01-step1.png"]["status"] == "unchanged" and by_name["TC-01-step1.png"]["old"]
    changed = by_name["TC-01-step2.png"]
    assert changed["status"] == "changed" and changed["changed_pixels"] == 400 and kit.path(changed["diff"]).exists()
    assert by_name["TC-02-step1.png"]["status"] == "new" and by_name["TC-02-step1.png"]["old"] == ""
    assert [f["name"] for f in data["flagged"]] == ["TC-01-step2.png"]
    assert data["baseline_run"] == "2026-10-01-1000"


def test_a_size_change_is_flagged_without_a_difference_image(kit):
    base = run_with_tests(kit, "2026-10-01-1000", ["TC-01"])
    shot(kit, base, "TC-01-step1.png", "white")
    kit.write_json(f"{base}/signoff.json", {"complete": True})
    run = run_with_tests(kit, "2026-10-02-1000", ["TC-01"])
    shot(kit, run, "TC-01-step1.png", "white", size=(50, 30))
    kit.run(COMPARE, run, expect=0)
    pair = kit.json(f"{run}/screens.json")["pairs"][0]
    assert pair["status"] == "changed" and "size changed" in pair["note"] and pair["diff"] == ""


def test_a_run_whose_sign_off_is_not_complete_is_no_baseline(kit):
    base = run_with_tests(kit, "2026-10-01-1000", ["TC-01"])
    shot(kit, base, "TC-01-step1.png", "white")
    kit.write_json(f"{base}/signoff.json", {"complete": False})
    run = run_with_tests(kit, "2026-10-02-1000", ["TC-01"])
    shot(kit, run, "TC-01-step1.png", "black")
    kit.run(COMPARE, run, expect=0)
    assert json.loads(kit.read(f"{run}/screens.json"))["baseline_run"] is None


def test_a_chosen_baseline_is_used_even_when_not_signed_off(kit):
    signed = run_with_tests(kit, "2026-10-01-1000", ["TC-01"])
    shot(kit, signed, "TC-01-step1.png", "white")
    kit.write_json(f"{signed}/signoff.json", {"decisions": {}, "complete": True})
    chosen = run_with_tests(kit, "2026-10-02-1000", ["TC-01"])
    shot(kit, chosen, "TC-01-step1.png", "white", box=(0, 0, 20, 20))

    run = run_with_tests(kit, "2026-10-03-1000", ["TC-01"])
    shot(kit, run, "TC-01-step1.png", "white", box=(0, 0, 20, 20))
    kit.run(COMPARE, run, "--baseline", "2026-10-02-1000", expect=0)
    data = kit.json(f"{run}/screens.json")
    assert data["baseline_run"] == "2026-10-02-1000" and data["unchanged"] == 1      # same as the chosen run
    r = kit.run(COMPARE, run, "--baseline", "2026-09-01-0000", expect=0)
    assert "No baseline run 2026-09-01-0000" in r.out
