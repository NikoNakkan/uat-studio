"""PreToolUse hook: checks every tool call against config/guardrails.yaml (blocked tools, sites, clicks, files).

VS Code runs this before each tool call of every agent (.github/hooks/guard.json) and passes the
call as JSON on stdin. It answers allow (no output), deny, or ask (pause for the person).

Input and output follow the VS Code hooks reference (docs/agents/reference/hooks-reference):
stdin {"tool_name", "tool_input", "tool_use_id"}; stdout {"hookSpecificOutput": {"hookEventName":
"PreToolUse", "permissionDecision": allow|deny|ask, "permissionDecisionReason"}}. MCP tool names may
carry a server prefix (to confirm in the agent debug log), so names are matched by their ending.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from common import origin_allowed, origin_of  # noqa: E402

RULES = yaml.safe_load((ROOT / "config" / "guardrails.yaml").read_text(encoding="utf-8"))


def decide(decision, reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                             "permissionDecision": decision,
                                             "permissionDecisionReason": reason}}))
    return 0


def origin(url):
    return origin_of(url)


def is_relative(url):
    """'/reports' or 'reports?x=1': stays on the page's current site, which was already allowed."""
    p = urlparse(url)
    return not p.scheme and not p.netloc


def strings_in(value):
    """Every string anywhere inside the tool input (paths can be nested or in lists)."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from strings_in(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings_in(v)


def word_in(word, text):
    return re.search(rf"(?<![a-z]){re.escape(word.lower())}(?![a-z])", text.lower()) is not None


def main():
    try:
        call = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0                                                # nothing to judge
    tool = str(call.get("tool_name") or call.get("toolName") or "")
    args = call.get("tool_input") or call.get("toolInput") or call.get("input") or {}

    blocked = next((b for b in RULES["blocked_tools"] if tool.endswith(b)), None)   # names may carry a server prefix
    if blocked:
        return decide("deny", f"{blocked} is blocked in UAT runs (config/guardrails.yaml).")

    # Files no agent may open, however the tool is called (a stray secrets file such as .env, rule 6 in AGENTS.md)
    protected = [p.lower() for p in RULES.get("protected_files") or []]
    if protected and "browser_" not in tool:
        for s in strings_in(args):
            name = s.replace("\\", "/").rstrip("/").split("/")[-1].lower()
            if name in protected or any(re.search(rf"(^|[\s\"'<>|/\\]){re.escape(p)}(?=$|[\s\"'<>|;&])", s.lower()) for p in protected):
                return decide("deny", f"'{name if name in protected else s[:60]}' is a protected file: agents never open it (config/guardrails.yaml).")

    if "browser_" not in tool:
        return 0                                                # not a browser tool: no further opinion
    name = tool[tool.index("browser_"):]                        # strip any server prefix

    if name == "browser_navigate":
        url = str(args.get("url", ""))
        if not is_relative(url) and not origin_allowed(url, RULES["allowed_origins"]):
            return decide("deny", f"{origin(url)} is not an allowed site ({', '.join(RULES['allowed_origins'])}).")

    if name in ("browser_click", "browser_hover", "browser_drag", "browser_select_option"):
        element = str(args.get("element") or args.get("startElement") or "").strip()
        if element.lower() in (n.lower() for n in RULES["never_click"]):
            return decide("deny", f'"{element}" is on the never-click list.')
        if name == "browser_click" and any(word_in(w, element) for w in RULES["ask_before_click_matching"]):
            return decide("ask", f'"{element}" looks destructive or irreversible. Approve this click?')

    if name == "browser_handle_dialog" and RULES.get("dialogs_need_approval") and args.get("accept"):
        return decide("ask", "The agent wants to accept a browser confirmation dialog. Approve?")

    return 0


if __name__ == "__main__":
    sys.exit(main())
