"""The agent loop caches the growing conversation, not only the system prompt, and reports cached tokens."""
import asyncio
from types import SimpleNamespace

from app import llm


class FakeMessages:
    def __init__(self):
        self.calls = []

    async def create(self, **kw):
        self.calls.append(kw)
        n = len(self.calls)
        usage = SimpleNamespace(input_tokens=100, output_tokens=10, cache_read_input_tokens=1000 * (n - 1),
                                cache_creation_input_tokens=200)
        if n == 1:   # first turn asks for a tool, second turn ends
            block = SimpleNamespace(type="tool_use", id="t1", name="echo", input={"x": 1},
                                    model_dump=lambda **_: {"type": "tool_use", "id": "t1", "name": "echo", "input": {"x": 1}})
            return SimpleNamespace(content=[block], stop_reason="tool_use", usage=usage)
        block = SimpleNamespace(type="text", text="done", model_dump=lambda **_: {"type": "text", "text": "done"})
        return SimpleNamespace(content=[block], stop_reason="end_turn", usage=usage)


def test_conversation_is_cached_and_cache_tokens_are_counted(monkeypatch):
    fake = FakeMessages()
    monkeypatch.setattr(llm, "client", lambda: SimpleNamespace(messages=fake))
    tool = llm.Tool("echo", "Echo.", {"type": "object", "properties": {}}, lambda a: llm.ToolResult("ok"))
    out = asyncio.run(llm.run_agent(channel="app", agent="uat-clarifier", system="S", prompt="P", tools=[tool]))
    assert len(fake.calls) == 2
    assert all(c.get("cache_control") == {"type": "ephemeral"} for c in fake.calls)          # the conversation tail
    assert all(c["system"][0]["cache_control"] == {"type": "ephemeral"} for c in fake.calls)  # the system prompt
    assert out.cache_read_tokens == 1000 and out.cache_write_tokens == 400
    assert out.input_tokens == 2 * 100 + 1000 + 400
