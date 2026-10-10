"""Power Apps canvas cases: the canvas specialist maps them and the generator gets the canvas rules."""
from app import kit, pw_agents

ENTRY = {"test_id": "TC-01", "group": "Orders", "plan_item": "1.1", "test_name": "TC-01 Create an order",
         "test_suite": "Orders", "test_file": "tests/orders/TC-01-create-an-order.spec.ts",
         "seed_file": "tests/seed.spec.ts", "login_line": "", "body": "Start page: https://apps.powerapps.com/play/x"}
CANVAS = {**ENTRY, "app_type": "canvas"}
WEB = {**ENTRY, "app_type": "web"}


def test_canvas_groups_go_to_the_canvas_specialist(client):
    assert pw_agents.planner_agent([WEB]) == "playwright-test-planner"
    assert pw_agents.planner_agent([WEB, CANVAS]) == "uat-canvas-specialist"
    assert "control_name" in pw_agents.planner_message([CANVAS])
    assert "control_name" not in pw_agents.planner_message([WEB])
    system = pw_agents._system("uat-canvas-specialist")
    assert "--- skill: mapping-canvas-apps ---" in system and "--- skill: testing-canvas-apps ---" in system


def test_generator_gets_canvas_rules_only_for_canvas_cases(client):
    canvas, web = pw_agents.generator_message(CANVAS), pw_agents.generator_message(WEB)
    assert "from '../canvas-fixtures'" in canvas and "canvas.type(locator, 'value')" in canvas
    assert "from '../fixtures'" in web and "canvas" not in web.split("App map elements")[0]
    assert "{" in web and "{{" not in web                     # format() left single braces


def test_switching_canvas_parts_off_falls_back(client):
    client.post("/api/features/switch", json={"id": "agent-canvas-specialist", "action": "off", "apply": True})
    client.post("/api/features/switch", json={"id": "skill-testing-canvas-apps", "action": "off", "apply": True})
    try:
        assert not kit.is_on("agent-canvas-specialist")
        assert pw_agents.planner_agent([CANVAS]) == "playwright-test-planner"
        assert "from '../fixtures'" in pw_agents.generator_message(CANVAS)
    finally:
        client.post("/api/features/switch", json={"id": "skill-testing-canvas-apps", "action": "on", "apply": True})
        client.post("/api/features/switch", json={"id": "agent-canvas-specialist", "action": "on", "apply": True})
    assert pw_agents.planner_agent([CANVAS]) == "uat-canvas-specialist"


def test_settings_list_the_canvas_agent(client):
    assert "uat-canvas-specialist" in client.get("/api/settings").json()["agents"]
