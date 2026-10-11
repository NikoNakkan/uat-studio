"""Power Apps canvas apps: wildcard sites in the guard, the canvas test rules, control names in the app map,
and app_type in the plan."""
import pytest
import yaml

from conftest import case

CHECK = ".github/skills/checking-generated-tests/scripts/check_tests.py"
MERGE = ".github/skills/mapping-the-app/scripts/merge_app_map.py"
PLAN = ".github/skills/writing-playwright-plan/scripts/excel_to_plan.py"
PLAY = "https://apps.powerapps.com/play/e/env1/a/app1?tenantId=t1"
TEST_FILE = "tests/orders/TC-01-create-an-order.spec.ts"

CANVAS_MAP = f"""pages:
  orders-screen:
    address: {PLAY}
    reached_by: start page
    ready_control: Gallery1
    elements:
      - {{control_name: Gallery1, control_type: gallery, role: list, name: Orders, screen: OrdersScreen}}
      - {{control_name: NewOrderButton, control_type: button, role: button, name: New order, screen: OrdersScreen}}
      - {{control_name: OrderNumberInput, control_type: textinput, role: textbox, name: Order number, screen: OrderFormScreen}}
      - {{control_name: SaveButton, control_type: button, role: button, name: Save, screen: OrderFormScreen}}
      - {{control_name: StatusLabel, control_type: label, role: text, name: '', example_text: Saved, screen: OrderFormScreen}}
"""

GOOD_CANVAS_TEST = f"""import {{ test, expect }} from '../canvas-fixtures';

test('TC-01 Create an order', async ({{ page, shot, canvas }}) => {{
  await page.goto('{PLAY}');
  await canvas.waitReady(canvas.control('Gallery1'));
  // 1. Click "New order"
  await canvas.click(canvas.control('NewOrderButton'));
  await shot(1);
  // 2. Type "ORD-0412" in Order number
  await canvas.type(canvas.input('OrderNumberInput'), 'ORD-0412');
  await shot(2);
  // 3. Click "Save"
  await canvas.click(canvas.control('SaveButton'));
  await expect(canvas.control('StatusLabel')).toHaveText('Saved ORD-0412');
  await shot(3);
}});
"""


def canvas_case(test_id="TC-01", **extra):
    return case(test_id, group="Orders", title="Create an order", start_page=PLAY,
                steps='1. Click "New order"\n2. Type "ORD-0412" in Order number\n3. Click "Save"',
                expected='3. The status shows "Saved ORD-0412"', **extra)


def allow_power_apps(kit):
    rails = kit.yaml("config/guardrails.yaml")
    rails["allowed_origins"] += ["https://apps.powerapps.com", "https://*.crm.dynamics.com"]
    kit.write("config/guardrails.yaml", yaml.safe_dump(rails, sort_keys=False))


@pytest.fixture
def run(kit):
    allow_power_apps(kit)
    kit.write("app-map/app-map.yaml", CANVAS_MAP)
    kit.excel("runs/cases.xlsx", [canvas_case()])
    return kit.intake("runs/cases.xlsx")


def check(kit, run, code):
    kit.write(TEST_FILE, code)
    r = kit.run(CHECK, run)
    return r, kit.json(f"{run}/test-check.json")["files"].get(TEST_FILE, {}).get("problems", [])


def nav(url):
    return {"tool_name": "browser_navigate", "tool_input": {"url": url}, "tool_use_id": "t1"}


def test_guard_wildcards_match_whole_name_parts_only(kit):
    allow_power_apps(kit)
    assert kit.hook(nav(PLAY))[0] is None
    assert kit.hook(nav("https://contoso.crm.dynamics.com/main.aspx"))[0] is None
    assert kit.hook(nav("https://contoso.eu.crm.dynamics.com/"))[0] is None
    for bad in ["https://crm.dynamics.com/", "https://contoso.crm.dynamics.com.evil.com/",
                "http://contoso.crm.dynamics.com/", "https://apps.powerapps.com.evil.com/"]:
        assert kit.hook(nav(bad))[0] == "deny", bad


def test_good_canvas_test_is_accepted(kit, run):
    r, problems = check(kit, run, GOOD_CANVAS_TEST)
    assert r.returncode == 0 and problems == [], r.out


@pytest.mark.parametrize("old, new, expected", [
    ("await canvas.type(canvas.input('OrderNumberInput'), 'ORD-0412');",
     "await canvas.input('OrderNumberInput').fill('ORD-0412');", ".fill("),
    ("await canvas.type(canvas.input('OrderNumberInput'), 'ORD-0412');",
     "await canvas.input('OrderNumberInput').pressSequentially('ORD-0412');", "pressSequentially("),
    ("await canvas.click(canvas.control('SaveButton'));",
     "await canvas.control('SaveButton').click({ force: true });", "force: true"),
    ("await canvas.click(canvas.control('SaveButton'));",
     "await page.frameLocator('iframe').locator('[data-control-name=\"SaveButton\"]').click();", "frameLocator("),
    ("await canvas.click(canvas.control('SaveButton'));",
     "await page.locator('[data-control-name=\"SaveButton\"]').click();", "not page.locator"),
    ("await canvas.click(canvas.control('SaveButton'));",
     "await canvas.click(canvas.galleryItems('Gallery1').nth(3));", ".nth("),
])
def test_canvas_shortcuts_are_rejected(kit, run, old, new, expected):
    r, problems = check(kit, run, GOOD_CANVAS_TEST.replace(old, new))
    assert r.returncode == 1 and any(expected in p for p in problems), problems


def test_canvas_check_must_target_a_mapped_control(kit, run):
    code = GOOD_CANVAS_TEST.replace("canvas.control('StatusLabel')", "canvas.control('Label7')")
    r, problems = check(kit, run, code)
    assert r.returncode == 1 and any("no check on an element recorded" in p for p in problems), problems


def test_gallery_exists_proves_nothing(kit, run):
    code = GOOD_CANVAS_TEST.replace("await expect(canvas.control('StatusLabel')).toHaveText('Saved ORD-0412');",
                                    "await expect(canvas.control('Gallery1')).toBeVisible();")
    r, problems = check(kit, run, code)
    assert r.returncode == 1, problems


def test_merge_keeps_control_names(kit):
    allow_power_apps(kit)
    kit.excel("runs/cases.xlsx", [canvas_case()])
    run = kit.intake("runs/cases.xlsx")
    body = CANVAS_MAP.replace("\n", "\n", 1)
    kit.write(f"{run}/planner-report-orders.md", f"## Mismatches\n\nNone\n\n## App map\n\n```yaml\n{body}```\n")
    r = kit.run(MERGE, run, "Orders", expect=0)
    elements = kit.yaml("app-map/app-map.yaml")["pages"]["orders-screen"]["elements"]
    assert {e["control_name"] for e in elements} >= {"Gallery1", "SaveButton", "StatusLabel"}, r.out
    save = next(e for e in elements if e["control_name"] == "SaveButton")
    assert save["control_type"] == "button" and save["screen"] == "OrderFormScreen"
    # two buttons with the same role and name stay apart when their control names differ
    twin = CANVAS_MAP.replace("NewOrderButton, control_type: button, role: button, name: New order",
                              "SaveButton2, control_type: button, role: button, name: Save")
    kit.write(f"{run}/planner-report-orders.md", f"## Mismatches\n\nNone\n\n## App map\n\n```yaml\n{twin}```\n")
    kit.run(MERGE, run, "Orders", expect=0)
    names = {e["control_name"] for e in kit.yaml("app-map/app-map.yaml")["pages"]["orders-screen"]["elements"]}
    assert {"SaveButton", "SaveButton2"} <= names


def test_plan_marks_canvas_cases(kit):
    allow_power_apps(kit)
    kit.excel("runs/cases.xlsx", [canvas_case(), case("TC-02")])
    run = kit.intake("runs/cases.xlsx")
    kit.run(PLAN, run, expect=0)
    todo = {g["test_id"]: g for g in kit.json(f"{run}/generate-list.json")}
    assert todo["TC-01"]["app_type"] == "canvas" and "canvas-fixtures" in todo["TC-01"]["body"]
    assert todo["TC-02"]["app_type"] == "web" and "canvas" not in todo["TC-02"]["body"]
