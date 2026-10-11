"""Playwright's own agents, hosted by the app.

The planner, generator and healer keep their unmodified instructions (.github/agents/playwright-test-*.agent.md)
and their own tool list, served by the real Playwright test MCP server (npx playwright run-test-mcp-server).
Every call passes the guard first.
"""
from __future__ import annotations

import base64
import contextlib
import fnmatch
import os
import re
from pathlib import Path

import yaml
from mcp import Client, StdioServerParameters

from . import guard, kit
from .llm import Tool, ToolResult
from .settings import load_settings

SKIP_DIRS = {"node_modules", ".git", "runs", "test-results", "playwright-report", "__pycache__"}


def load_agent_file(name: str) -> tuple[dict, str]:
    """Front matter and instructions of an agent file in the kit."""
    text = (kit.KIT_DIR / ".github" / "agents" / f"{name}.agent.md").read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        return {}, text
    try:
        return yaml.safe_load(m.group(1)) or {}, m.group(2).strip()
    except yaml.YAMLError:
        return _lenient_front_matter(m.group(1)), m.group(2).strip()


def _lenient_front_matter(block: str) -> dict:
    """VS Code accepts front matter such as 'description: Sets up X: asks Y'; strict YAML does not."""
    meta: dict = {}
    key = None
    for line in block.splitlines():
        top = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", line)
        if top:
            key, value = top.group(1), top.group(2).strip()
            try:
                meta[key] = yaml.safe_load(value) if value.startswith(("[", "{", "'", '"')) else (value or [])
            except yaml.YAMLError:
                meta[key] = value
        elif key and line.strip().startswith("- "):
            if not isinstance(meta.get(key), list):
                meta[key] = []
            meta[key].append(line.strip()[2:].strip().strip("'\""))
    return meta


def load_skill(name: str, with_references: bool = False) -> str:
    folder = kit.KIT_DIR / ".github" / "skills" / name
    parts = [(folder / "SKILL.md").read_text(encoding="utf-8")]
    if with_references and (folder / "references").exists():
        for ref in sorted((folder / "references").glob("*.md")):
            parts.append(f"\n\n--- references/{ref.name} ---\n" + ref.read_text(encoding="utf-8"))
    return "\n".join(parts)


@contextlib.asynccontextmanager
async def playwright_server(run_dir: Path | None):
    """Start the Playwright test MCP server for one stage, in the kit, with the run's folders."""
    env = {"UAT_PROGRESS": "0"}                       # agent test runs never write the run's progress
    if run_dir is not None:
        env.update(UAT_RUN_DIR=str(run_dir), UAT_EVIDENCE_DIR=str(run_dir / "evidence-agents"))
    server = ["npx", "playwright", "run-test-mcp-server"] + ([] if load_settings().show_agent_browser else ["--headless"])
    if os.name == "nt":
        params = StdioServerParameters(command="cmd", args=["/c", *server], cwd=str(kit.KIT_DIR), env=env)
    else:
        params = StdioServerParameters(command=server[0], args=server[1:], cwd=str(kit.KIT_DIR), env=env)
    async with Client(params, read_timeout_seconds=180) as client:
        yield client


def _result_from_mcp(result) -> ToolResult:
    texts, images = [], []
    for block in result.content or []:
        kind = getattr(block, "type", "")
        if kind == "text":
            texts.append(block.text)
        elif kind == "image":
            images.append((block.mime_type, block.data))
        else:
            texts.append(f"[{kind} content]")
    return ToolResult("\n".join(texts), images, bool(getattr(result, "is_error", False)))


async def playwright_tools(client: Client, agent: str, channel: str, allowed_edit: set[str] | None = None) -> list[Tool]:
    """The tools named in the Playwright agent's own file, wrapped with the guard."""
    meta, _ = load_agent_file(agent)
    wanted = list(meta.get("tools", []))
    mcp_names = {t.split("/", 1)[1] for t in wanted if t.startswith("playwright-test/")}
    listing = await client.list_tools()
    tools: list[Tool] = []
    for t in listing.tools:
        if t.name not in mcp_names:
            continue

        async def handler(args: dict, _name=t.name) -> ToolResult:
            ok, why = await guard.check(channel, agent, f"playwright-test/{_name}", args)
            if not ok:
                return ToolResult(why, is_error=True)
            return _result_from_mcp(await client.call_tool(_name, args))

        tools.append(Tool(t.name, t.description or t.name, t.input_schema or {"type": "object"}, handler))
    if "search" in wanted:
        tools += search_tools(channel, agent)
    if "edit" in wanted and allowed_edit:
        tools += edit_tools(channel, agent, allowed_edit)
    return tools


# ---------------- the VS Code "search" and "edit" tool sets, limited to the kit ----------------

def _walk():
    root = kit.KIT_DIR
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if f.lower() == ".env":
                continue
            yield Path(dirpath) / f


def search_tools(channel: str, agent: str) -> list[Tool]:
    async def list_directory(args: dict) -> ToolResult:
        ok, why = await guard.check(channel, agent, "search/listDirectory", args)
        if not ok:
            return ToolResult(why, is_error=True)
        p = kit.safe_kit_path(args.get("path", "."))
        if not p.is_dir():
            return ToolResult(f"Not a folder: {args.get('path')}", is_error=True)
        names = sorted(x.name + ("/" if x.is_dir() else "") for x in p.iterdir()
                       if x.name not in SKIP_DIRS and x.name.lower() != ".env")
        return ToolResult("\n".join(names))

    async def file_search(args: dict) -> ToolResult:
        ok, why = await guard.check(channel, agent, "search/fileSearch", args)
        if not ok:
            return ToolResult(why, is_error=True)
        pattern = args.get("pattern", "*")
        hits = [p.relative_to(kit.KIT_DIR).as_posix() for p in _walk()
                if fnmatch.fnmatch(p.relative_to(kit.KIT_DIR).as_posix(), pattern) or fnmatch.fnmatch(p.name, pattern)]
        return ToolResult("\n".join(hits[:200]) or "No files match.")

    async def text_search(args: dict) -> ToolResult:
        ok, why = await guard.check(channel, agent, "search/textSearch", args)
        if not ok:
            return ToolResult(why, is_error=True)
        query, hits = args.get("query", ""), []
        for p in _walk():
            if p.suffix.lower() not in (".ts", ".js", ".md", ".yaml", ".yml", ".json", ".txt"):
                continue
            try:
                for n, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                    if query.lower() in line.lower():
                        hits.append(f"{p.relative_to(kit.KIT_DIR).as_posix()}:{n}: {line.strip()[:200]}")
            except OSError:
                continue
            if len(hits) > 100:
                break
        return ToolResult("\n".join(hits) or "No matches.")

    obj = lambda props, req: {"type": "object", "properties": props, "required": req}  # noqa: E731
    return [
        Tool("list_directory", "List a folder of the repository.", obj({"path": {"type": "string"}}, ["path"]), list_directory),
        Tool("file_search", "Find files by a glob pattern, e.g. tests/**/*.spec.ts.",
             obj({"pattern": {"type": "string"}}, ["pattern"]), file_search),
        Tool("text_search", "Find text in the repository's files.", obj({"query": {"type": "string"}}, ["query"]), text_search),
    ]


def edit_tools(channel: str, agent: str, allowed: set[str]) -> list[Tool]:
    """read_file and edit_file, limited to the files this agent may change (the healer: one test)."""
    async def read_file(args: dict) -> ToolResult:
        ok, why = await guard.check(channel, agent, "read/readFile", args)
        if not ok:
            return ToolResult(why, is_error=True)
        p = kit.safe_kit_path(args.get("path", ""))
        return ToolResult(p.read_text(encoding="utf-8"))

    async def edit_file(args: dict) -> ToolResult:
        ok, why = await guard.check(channel, agent, "edit/editFiles", args)
        if not ok:
            return ToolResult(why, is_error=True)
        rel = str(args.get("path", "")).replace("\\", "/")
        if rel not in allowed:
            return ToolResult(f"You may only edit: {', '.join(sorted(allowed))}", is_error=True)
        p = kit.safe_kit_path(rel)
        text = p.read_text(encoding="utf-8")
        old, new = args.get("old_text", ""), args.get("new_text", "")
        if not old or text.count(old) != 1:
            return ToolResult("old_text must appear exactly once in the file.", is_error=True)
        p.write_text(text.replace(old, new), encoding="utf-8")
        return ToolResult("Edited.")

    obj = lambda props, req: {"type": "object", "properties": props, "required": req}  # noqa: E731
    return [
        Tool("read_file", "Read a file of the repository.", obj({"path": {"type": "string"}}, ["path"]), read_file),
        Tool("edit_file", "Replace one exact piece of text in a file you are allowed to edit.",
             obj({"path": {"type": "string"}, "old_text": {"type": "string"}, "new_text": {"type": "string"}},
                 ["path", "old_text", "new_text"]), edit_file),
    ]


def image_result(path: Path, note: str = "") -> ToolResult:
    data = base64.b64encode(path.read_bytes()).decode()
    return ToolResult(note or path.name, [("image/png", data)])
