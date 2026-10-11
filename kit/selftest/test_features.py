"""scripts/features.py: the feature map, the profile and the switch page."""


def test_map_is_consistent(kit):
    r = kit.run("scripts/features.py", "check", expect=0)
    assert "Feature map OK" in r.out


def test_is_on_exit_codes(kit):
    kit.run("scripts/features.py", "is-on", "traces", expect=0)
    r = kit.run("scripts/features.py", "is-on", "no-such-part", expect=2)
    assert "Unknown id" in r.out


def test_off_without_yes_changes_nothing(kit):
    before = kit.read("config/profile.yaml")
    r = kit.run("scripts/features.py", "off", "traces", expect=0)
    assert "Nothing changed" in r.out
    assert kit.read("config/profile.yaml") == before


def test_off_and_on_round_trip(kit):
    kit.run("scripts/features.py", "off", "traces", "--yes", expect=0)
    profile = kit.yaml("config/profile.yaml")
    assert "traces" in profile["switched_off"]          # the key is switched_off, never "off" (YAML reads that as false)
    kit.run("scripts/features.py", "is-on", "traces", expect=1)
    kit.run("scripts/features.py", "check", expect=0)   # the profile stays consistent
    kit.run("scripts/features.py", "on", "traces", "--yes", expect=0)
    assert kit.yaml("config/profile.yaml")["switched_off"] == []


def test_switching_off_cascades_to_dependents(kit):
    items = kit.yaml("config/features.yaml")["items"]
    dependents = {i["id"] for i in items if "step-screenshots" in i.get("requires", []) and i.get("status", "built") == "built"}
    assert dependents, "the map should have parts that need step-screenshots"
    r = kit.run("scripts/features.py", "off", "step-screenshots", "--yes", expect=0)
    assert "also off" in r.out
    off = set(kit.yaml("config/profile.yaml")["switched_off"])
    assert "step-screenshots" in off and dependents <= off


def test_core_parts_cannot_be_switched_off(kit):
    r = kit.run("scripts/features.py", "off", "excel-template", "--yes", expect=1)
    assert "core" in r.out
    assert kit.yaml("config/profile.yaml")["switched_off"] == []


def test_check_reports_profile_problems(kit):
    kit.write("config/profile.yaml", "switched_off:\n  - no-such-part\n  - excel-template\n")
    r = kit.run("scripts/features.py", "check", expect=1)
    assert "unknown id 'no-such-part'" in r.out and "core" in r.out


def test_page_embeds_the_map(kit):
    r = kit.run("scripts/features.py", "page", "runs/switches.html", expect=0)
    html = kit.read("runs/switches.html")
    assert "/*__FEATURE_DATA__*/null" not in html and '"items"' in html and "excel-template" in html
    assert "Wrote" in r.out
