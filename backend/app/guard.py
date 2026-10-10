"""Every tool call of every agent goes through the kit's own guard (scripts/guard_hook.py).

The same script VS Code runs as a PreToolUse hook. Its "ask" answer becomes an approval the
person gives in the app; "deny" is returned to the agent as an error it can read.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess

from . import kit
from .interactions import interactions


def _decide_blocking(tool_name: str, args: dict) -> tuple[str, str]:
    payload = json.dumps({"hook_event_name": "PreToolUse", "tool_name": tool_name, "tool_input": args})
    proc = subprocess.run([kit.PY, str(kit.KIT_DIR / kit.SCRIPTS["guard"])], input=payload, capture_output=True,
                          text=True, encoding="utf-8", cwd=kit.KIT_DIR, timeout=20,
                          env=dict(os.environ, PYTHONIOENCODING="utf-8"))
    out = proc.stdout.strip()
    if not out:
        return "allow", ""
    try:
        spec = json.loads(out)["hookSpecificOutput"]
        return spec.get("permissionDecision", "allow"), spec.get("permissionDecisionReason", "")
    except (ValueError, KeyError):
        return "deny", f"The guard answered something unreadable: {out[:200]}"


async def check(channel: str, agent: str, tool_name: str, args: dict) -> tuple[bool, str]:
    """True when the call may go ahead. Asks the person when the guard says ask."""
    decision, reason = await asyncio.to_thread(_decide_blocking, tool_name, args)
    if decision == "deny":
        return False, f"Refused by the guard: {reason}"
    if decision == "ask":
        answer = await interactions.ask(channel, "guard", f"{agent} wants to: {tool_name}",
                                        reason=reason, agent=agent, tool=tool_name,
                                        input={k: v for k, v in args.items() if k != "code"},
                                        options=["approve", "refuse"])
        if answer != "approve":
            return False, "The person refused this action."
    return True, ""
