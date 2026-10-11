"""The agent loop on GitHub Copilot: one agent conversation as a Copilot SDK session, billed to the signed-in
user's Copilot plan instead of an Anthropic API key.

The session gets exactly the agent's own tools and nothing else ("empty" mode with an allow-list: none of
Copilot's built-in shell, file or web tools), so every action still goes through Studio's tool handlers and
the kit's guard. The agent's instructions replace Copilot's default system prompt. What it says and every
tool call show live in the activity, as with the Anthropic loop.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from copilot import CopilotClient
from copilot.tools import Tool as CopilotTool
from copilot.tools import ToolBinaryResult, ToolInvocation
from copilot.tools import ToolResult as CopilotToolResult

from .events import bus
from .llm import MAX_TOOL_TEXT, AgentOutcome, Tool, _call_tool, _summary
from .settings import STATE_DIR, load_settings

_runtime: dict[str, CopilotClient] = {}           # the one Copilot runtime, started on first use
_lock = asyncio.Lock()


def copilot_model(model: str) -> str:
    """Studio's model ids as Copilot names them: claude-sonnet-5-5 -> claude-sonnet-5.5."""
    return re.sub(r"-(\d+)-(\d+)$", r"-\1.\2", model)


async def client() -> CopilotClient:
    """One Copilot runtime for the whole app, started on first use, with its own storage folder."""
    async with _lock:
        if "client" not in _runtime:
            folder = STATE_DIR / "copilot"
            folder.mkdir(parents=True, exist_ok=True)
            c = CopilotClient(mode="empty", base_directory=str(folder))
            await c.start()
            _runtime["client"] = c
        return _runtime["client"]


def _wrap(tool: Tool, say) -> CopilotTool:
    """A Studio tool as a Copilot tool: the same handler (and guard), its result and images passed back."""
    async def handler(inv: ToolInvocation) -> CopilotToolResult:
        args = inv.arguments if isinstance(inv.arguments, dict) else {}
        say("tool_call", tool=tool.name, input=_summary(args))
        out = await _call_tool(tool, tool.name, args)
        text = out.text if len(out.text) <= MAX_TOOL_TEXT else out.text[:MAX_TOOL_TEXT] + "\n… (cut)"
        say("tool_result", tool=tool.name, text=_summary(text, 600), is_error=out.is_error, images=len(out.images))
        return CopilotToolResult(
            text_result_for_llm=text or "(no output)", result_type="failure" if out.is_error else "success",
            binary_results_for_llm=[ToolBinaryResult(data=d, mime_type=m, type="image") for m, d in out.images[:4]] or None)
    return CopilotTool(name=tool.name, description=tool.description[:1000], parameters=tool.input_schema,
                       handler=handler, skip_permission=True)


def _refuse(request: Any, invocation: Any) -> Any:
    """Anything that is not one of the agent's own tools is refused (there should be nothing else)."""
    from copilot.generated.rpc import PermissionDecisionReject  # noqa: PLC0415 - only needed when something asks
    return PermissionDecisionReject(feedback="Only the tools given to this agent may be used.")


class _Conversation:
    """What one Copilot session said and used, collected from its events."""

    def __init__(self, say, wanted: str, turns_left: int):
        self.say, self.wanted, self.turns_left = say, wanted, turns_left
        self.text, self.turns, self.model, self.stopped, self.error = "", 0, wanted, "end_turn", ""
        self.input = self.output = self.read = self.write = 0
        self.requests = 0.0
        self.done = asyncio.Event()
        self.session: Any = None
        self.aborting: asyncio.Task | None = None

    def on_event(self, e: Any) -> None:
        kind, data = e.type.value, getattr(e, "data", None)
        if kind == "assistant.message" and (getattr(data, "content", "") or "").strip():
            self.text = data.content
            self.say("agent_text", text=data.content)
        elif kind == "assistant.usage":
            self.input += data.input_tokens or 0
            self.output += data.output_tokens or 0
            self.read += data.cache_read_tokens or 0
            self.write += data.cache_write_tokens or 0
            self.requests += data.cost or 0
            self.model = data.model or self.model
        elif kind == "assistant.turn_start":
            # A turn beyond the limit is stopped as it starts; a last turn that answers is not cut off.
            self.turns += 1
            if self.turns > self.turns_left and self.aborting is None:
                self.turns -= 1
                self.stopped = "max_turns"
                self.aborting = asyncio.ensure_future(self.session.abort())
        elif kind == "session.error":
            self.stopped, self.error = "error", str(getattr(data, "message", "") or data)
            self.done.set()
        elif kind == "session.idle":
            self.done.set()

    def outcome(self) -> AgentOutcome:
        if self.model != self.wanted:
            self.say("note", text=f"Copilot answered with {self.model}: your Copilot plan does not include {self.wanted}.")
        if self.stopped == "error":
            self.say("agent_error", text=f"Copilot stopped with an error: {self.error}")
            self.text = self.text or f"(Copilot error: {self.error})"
        elif self.stopped == "max_turns":
            self.say("agent_error", text=f"Stopped after {self.turns_left} turns (run limit). The stage can be resumed.")
        total_in = self.input + self.read + self.write
        self.say("agent_end", model=f"copilot:{self.model}", turns=self.turns, stopped=self.stopped, input_tokens=total_in,
                 output_tokens=self.output, cache_read_tokens=self.read, cache_write_tokens=self.write,
                 premium_requests=self.requests)
        return AgentOutcome(self.text, total_in, self.output, f"copilot:{self.model}", self.turns, self.stopped,
                            self.read, self.write)


async def run_agent(*, channel: str, agent: str, system: str, prompt: str | list, tools: list[Tool],
                    stage: str = "", max_turns: int | None = None) -> AgentOutcome:
    settings = load_settings()
    wanted = copilot_model(settings.model_for(agent))
    text_prompt = prompt if isinstance(prompt, str) else "\n\n".join(
        b.get("text", "") for b in prompt if isinstance(b, dict) and b.get("type") == "text")

    def say(type_: str, **data: Any) -> None:
        bus.emit(channel, type_, agent=agent, stage=stage, **data)

    conv = _Conversation(say, wanted, max_turns or settings.max_turns)
    say("agent_start", model=f"copilot:{wanted}")
    try:
        c = await client()
        conv.session = await c.create_session(
            model=wanted, tools=[_wrap(t, say) for t in tools], available_tools=[t.name for t in tools],
            system_message={"mode": "replace", "content": system}, on_permission_request=_refuse)
    except Exception as e:
        say("agent_error", text=f"Copilot could not start the session: {e}")
        return AgentOutcome(f"(Copilot could not start: {e})", 0, 0, f"copilot:{wanted}", 0, "error")
    conv.session.on(conv.on_event)
    try:
        await conv.session.send(text_prompt)
        await conv.done.wait()
    except asyncio.CancelledError:                 # the run was stopped: stop the model too
        await conv.session.abort()
        raise
    finally:
        await conv.session.disconnect()
    return conv.outcome()


async def status() -> dict:
    """Who is signed in to Copilot and what the plan allows this month."""
    from copilot.generated.rpc import AccountGetQuotaRequest  # noqa: PLC0415
    c = await client()
    auth = (await c.get_auth_status()).to_dict()
    quota: dict = {}
    try:
        snaps = (await c.rpc.account.get_quota(AccountGetQuotaRequest())).to_dict().get("quotaSnapshots", {})
        quota = {k: {"used": v.get("usedRequests"), "allowed": v.get("entitlementRequests"),
                     "unlimited": v.get("isUnlimitedEntitlement"), "resets": v.get("resetDate")} for k, v in snaps.items()}
    except Exception:                                # the plan is not essential to show the sign-in
        pass
    return {"signed_in": bool(auth.get("isAuthenticated")), "login": auth.get("login"), "via": auth.get("authType"),
            "quota": quota}
