"""The agent loop: one conversation with Claude, with only the tools that agent's job needs.

Every model reply and tool call is shown live in the run's activity. Token counts come from the
API itself, so usage tracking is exact (decision 32), and each agent stops after max_turns (F8).
"""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from anthropic import AsyncAnthropic

from .events import bus
from .settings import load_settings

MAX_TOOL_TEXT = 40_000


@dataclass
class ToolResult:
    text: str = ""
    images: list[tuple[str, str]] = field(default_factory=list)   # (media_type, base64 data)
    is_error: bool = False


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    handler: Callable[[dict], Awaitable[ToolResult | str]]

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description[:1000], "input_schema": self.input_schema}


@dataclass
class AgentOutcome:
    text: str
    input_tokens: int
    output_tokens: int
    model: str
    turns: int
    stopped: str            # end_turn | max_turns | max_tokens | error
    cache_read_tokens: int = 0      # part of input_tokens served from the cache (about a tenth of the price)
    cache_write_tokens: int = 0     # part of input_tokens written to the cache (about 1.25x the price)


class MissingApiKey(RuntimeError):
    pass


def client() -> AsyncAnthropic:
    key = load_settings().effective_api_key()
    if not key:
        raise MissingApiKey("No API key. Add your Anthropic API key in Settings.")
    return AsyncAnthropic(api_key=key, max_retries=4)


def _summary(value: Any, limit: int = 300) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[:limit] + "…"


@dataclass
class _Usage:
    """Token use across one conversation; cache reads and writes are part of the input count."""
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0

    def add(self, u: Any) -> None:
        read, write = u.cache_read_input_tokens or 0, u.cache_creation_input_tokens or 0
        self.input += (u.input_tokens or 0) + read + write
        self.output += u.output_tokens or 0
        self.cache_read += read
        self.cache_write += write


async def _call_tool(tool: Tool | None, name: str, args: dict) -> ToolResult:
    """Run one tool call; an unknown tool or a failing handler becomes an error the model can see and correct."""
    if tool is None:
        return ToolResult(f"Unknown tool {name}. Use only the tools you were given.", is_error=True)
    try:
        raw = await tool.handler(args)
    except Exception as e:
        return ToolResult(f"Tool failed: {e}", is_error=True)
    return raw if isinstance(raw, ToolResult) else ToolResult(str(raw))


def _result_block(call_id: str, out: ToolResult, text: str) -> dict:
    """A tool result as the model receives it: the text (cut to MAX_TOOL_TEXT) and up to four images."""
    blocks: list[dict] = [{"type": "text", "text": text or "(no output)"}]
    blocks += [{"type": "image", "source": {"type": "base64", "media_type": media, "data": data}}
               for media, data in out.images[:4]]
    return {"type": "tool_result", "tool_use_id": call_id, "content": blocks, "is_error": out.is_error}


async def run_agent(*, channel: str, agent: str, system: str, prompt: str | list, tools: list[Tool],
                    stage: str = "", max_turns: int | None = None) -> AgentOutcome:
    """Run one agent conversation to its end. Raises MissingApiKey when no key is set."""
    settings = load_settings()
    if settings.provider == "copilot":                 # the same conversation on the person's Copilot plan
        from .copilot_llm import run_agent as run_on_copilot  # noqa: PLC0415 - copilot_llm imports this module
        return await run_on_copilot(channel=channel, agent=agent, system=system, prompt=prompt, tools=tools,
                                    stage=stage, max_turns=max_turns)
    model = settings.model_for(agent)
    turns_left = max_turns or settings.max_turns
    by_name = {t.name: t for t in tools}
    api = client()
    messages: list[dict] = [{"role": "user", "content": prompt}]
    usage = _Usage()
    final_text, stopped, turns = "", "end_turn", 0

    def say(type_: str, **data: Any) -> None:
        bus.emit(channel, type_, agent=agent, stage=stage, **data)

    say("agent_start", model=model)
    while turns < turns_left:
        turns += 1
        try:
            # Two cache points: the fixed system prompt, and (top-level, automatic) the end of the conversation.
            # Every turn resends the whole conversation; without the second point each earlier page
            # snapshot and tool result was paid in full again on every later turn.
            response = await api.messages.create(
                model=model, max_tokens=settings.max_output_tokens,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                cache_control={"type": "ephemeral"},
                tools=[t.spec() for t in tools] or [], messages=messages)
        except Exception as e:
            say("agent_error", text=str(e))
            stopped, final_text = "error", f"(the model call failed: {e})"
            break
        usage.add(response.usage)
        messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in response.content]})
        texts = [b.text for b in response.content if b.type == "text" and b.text.strip()]
        if texts:
            final_text = "\n".join(texts)
            say("agent_text", text=final_text)
        calls = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not calls:
            stopped = "max_tokens" if response.stop_reason == "max_tokens" else "end_turn"
            break
        results = []
        for call in calls:
            say("tool_call", tool=call.name, input=_summary(call.input))
            out = await _call_tool(by_name.get(call.name), call.name, call.input or {})
            text = out.text if len(out.text) <= MAX_TOOL_TEXT else out.text[:MAX_TOOL_TEXT] + "\n… (cut)"
            say("tool_result", tool=call.name, text=_summary(text, 600), is_error=out.is_error, images=len(out.images))
            results.append(_result_block(call.id, out, text))
        messages.append({"role": "user", "content": results})
    else:
        stopped = "max_turns"
        say("agent_error", text=f"Stopped after {turns_left} turns (run limit). The stage can be resumed.")

    say("agent_end", model=model, turns=turns, stopped=stopped, input_tokens=usage.input, output_tokens=usage.output,
        cache_read_tokens=usage.cache_read, cache_write_tokens=usage.cache_write)
    return AgentOutcome(final_text, usage.input, usage.output, model, turns, stopped, usage.cache_read, usage.cache_write)


async def complete_json(*, channel: str, agent: str, system: str, prompt: str, stage: str = "") -> tuple[Any, AgentOutcome]:
    """One answer with no tools, parsed as JSON (the reporter's reasoning lines)."""
    outcome = await run_agent(channel=channel, agent=agent, system=system, prompt=prompt, tools=[], stage=stage,
                              max_turns=1)
    text = outcome.text.strip()
    start, end = text.find("{"), text.rfind("}")
    try:
        return json.loads(text[start:end + 1]), outcome
    except (ValueError, json.JSONDecodeError):
        return {}, outcome
