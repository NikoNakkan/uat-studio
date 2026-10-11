"""scripts/guard_hook.py: what the browser and the file tools may do (config/guardrails.yaml)."""


def call(tool, **tool_input):
    return {"tool_name": tool, "tool_input": tool_input, "tool_use_id": "t1"}


def test_blocked_tools_are_denied_even_with_a_server_prefix(kit):
    decision, reason = kit.hook(call("mcp_playwright-test_browser_evaluate", function="() => 1"))
    assert decision == "deny" and "browser_evaluate is blocked" in reason
    assert kit.hook(call("planner_save_plan", plan="x"))[0] == "deny"


def test_navigation_stays_on_allowed_sites(kit):
    assert kit.hook(call("browser_navigate", url="http://localhost:4173/expenses"))[0] is None
    assert kit.hook(call("browser_navigate", url="/reports?x=1"))[0] is None            # relative: same site
    decision, reason = kit.hook(call("browser_navigate", url="https://evil.example.com/"))
    assert decision == "deny" and "https://evil.example.com is not an allowed site" in reason


def test_clicks(kit):
    assert kit.hook(call("browser_click", element="Add expense", ref="e1"))[0] is None
    assert kit.hook(call("browser_click", element="clear ALL", ref="e2"))[0] == "deny"            # never-click, any case
    decision, reason = kit.hook(call("browser_click", element="Delete Taxi", ref="e3"))
    assert decision == "ask" and "destructive" in reason
    assert kit.hook(call("browser_click", element="Undeleted items", ref="e4"))[0] is None       # whole word only
    assert kit.hook(call("browser_hover", element="Clear all", ref="e5"))[0] == "deny"


def test_dialogs_need_approval(kit):
    assert kit.hook(call("browser_handle_dialog", accept=True))[0] == "ask"
    assert kit.hook(call("browser_handle_dialog", accept=False))[0] is None


def test_env_is_protected_from_every_tool(kit):
    for tool, args in [("read_file", {"path": "c:/kit/.env"}), ("readFile", {"filePath": "/home/u/kit/.env"}),
                       ("run_in_terminal", {"command": "cat .env"}), ("run_in_terminal", {"command": "type .env | more"}),
                       ("run_in_terminal", {"command": "Get-Content '.env'"}), ("search", {"paths": ["a.py", ".env"]})]:
        decision, reason = kit.hook(call(tool, **args))
        assert decision == "deny" and "protected file" in reason, (tool, args, decision)
    assert kit.hook(call("read_file", path="c:/kit/.env.example"))[0] is None
    assert kit.hook(call("run_in_terminal", command="python scripts/features.py check"))[0] is None


def test_unrelated_tools_and_bad_input_are_allowed(kit):
    assert kit.hook(call("edit_file", path="tests/x.spec.ts", content="x"))[0] is None
    assert kit.hook("not json at all")[0] is None
