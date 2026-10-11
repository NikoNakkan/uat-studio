"""The guardrails as settings: read, check and write config/guardrails.yaml.

The kit's guard (scripts/guard_hook.py) reads the file before every tool call of every agent, so a saved
change applies to the next call. The file is written back with its explanations, so it stays readable for
people who open it in an editor or VS Code.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from . import kit

# Tools an agent can be refused outright, with what each one does: the ones the kit blocks by default.
KNOWN_TOOLS = {
    "browser_evaluate": "Runs code inside the page (planner, generator, healer have it)",
    "browser_run_code": "Runs a Playwright script in the browser",
    "browser_run_code_unsafe": "Runs any code (the planner has it)",
    "browser_file_upload": "Uploads files from this computer into the app",
    "planner_save_plan": "Lets the planner rewrite our plan (decision 4: it only reports mismatches)",
}
ALWAYS_PROTECTED = ".env"           # the passwords (rule 6 in AGENTS.md): tests read it, agents never do
DEFAULTS = {"allowed_origins": [], "blocked_tools": list(KNOWN_TOOLS), "protected_files": [ALWAYS_PROTECTED],
            "never_click": [], "ask_before_click_matching": [], "dialogs_need_approval": True}
ORIGIN = re.compile(r"^https?://[^/\s]+$")
TOOL = re.compile(r"^[a-z][a-z0-9_]*$")


def path(folder: Path | None = None) -> Path:
    return (folder or kit.KIT_DIR) / "config" / "guardrails.yaml"


def load(folder: Path | None = None) -> dict:
    p = path(folder)
    data = (yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else None) or {}
    return {k: data.get(k, v) for k, v in DEFAULTS.items()}


def _words(items, what: str, errors: list[str]) -> list[str]:
    out = []
    for item in items or []:
        s = str(item).strip()
        if not s:
            continue
        if "\n" in s:
            errors.append(f"{what}: one entry per line.")
        elif s not in out:
            out.append(s)
    return out


def clean(data: dict) -> tuple[dict, list[str]]:
    """The settings as they will be saved, and what is wrong with them (nothing is saved while anything is)."""
    errors: list[str] = []
    origins = [o.rstrip("/") for o in _words(data.get("allowed_origins"), "Sites", errors)]
    errors += [f"'{o}' is not a site: give the scheme and host only, e.g. https://test.app.example.com" for o in origins
               if not ORIGIN.match(o)]
    if not origins:
        errors.append("Give at least one site the browser may open.")
    tools = _words(data.get("blocked_tools"), "Tools", errors)
    errors += [f"'{t}' is not a tool name (lowercase letters, digits and _)." for t in tools if not TOOL.match(t)]
    files = _words(data.get("protected_files"), "Files", errors)
    errors += [f"'{f}' must be a path inside the project." for f in files if ".." in f or f.startswith(("/", "\\"))]
    if ALWAYS_PROTECTED not in files:
        files.insert(0, ALWAYS_PROTECTED)
    return {"allowed_origins": origins, "blocked_tools": tools, "protected_files": files,
            "never_click": _words(data.get("never_click"), "Never click", errors),
            "ask_before_click_matching": [w.lower() for w in _words(data.get("ask_before_click_matching"), "Ask before", errors)],
            "dialogs_need_approval": bool(data.get("dialogs_need_approval", True))}, errors


def _list(key: str, note: str, items: list[str], notes: dict[str, str] | None = None, extra: str = "") -> str:
    lines = [f"{key + ':':<37}# {note}"]
    for i in items:
        tail = (notes or {}).get(i)
        lines.append(f"  - {i:<33}# {tail}" if tail else f"  - {i}")
    if not items:
        lines[0] = f"{key + ': []':<37}# {note}"
    return "\n".join(lines) + extra + "\n"


def render(g: dict) -> str:
    powerapps = ('\n  # Power Apps canvas apps (see config/power-platform.yaml). "*" stands for one or more name parts:'
                 "\n  # - https://apps.powerapps.com\n  # - https://login.microsoftonline.com"
                 "\n  # - https://*.crm.dynamics.com          # model-driven apps and Dataverse")
    return "\n".join([
        "# Read by scripts/guard_hook.py, which VS Code runs before every tool call of every agent",
        "# (.github/hooks/guard.json). Playwright MCP's own origin options are \"not a security",
        "# boundary\" (Playwright MCP docs), so the hook enforces these rules instead.",
        "# UAT Studio edits this file on its Guardrails page.",
        "",
        _list("allowed_origins", "the browser may only open these sites", g["allowed_origins"], extra=powerapps),
        _list("blocked_tools", "refused outright", g["blocked_tools"],
              {t: n[0].lower() + n[1:] for t, n in KNOWN_TOOLS.items()}),
        _list("protected_files", "no agent may open these with any file tool or shell command", g["protected_files"],
              {ALWAYS_PROTECTED: "the passwords (rule 6 in AGENTS.md); tests read it, agents never do"}),
        _list("never_click", "refused outright (exact element names, any case)", g["never_click"]),
        _list("ask_before_click_matching", "pause and ask the person first (whole word in the element name)",
              g["ask_before_click_matching"]),
        f"dialogs_need_approval: {'true' if g['dialogs_need_approval'] else 'false'}          "
        "# accepting a browser confirm dialog asks the person",
        "",
        "# Relative addresses (\"/reports\") are allowed: they stay on the site the page is already on.",
        "# Test code is guarded separately: check_tests.py rejects goto() to other sites, route(), evaluate() ...",
        "# (config/test-check-rules.yaml), because the hook only sees tool calls, not the tests that run later.",
        "",
    ])


def save(data: dict, folder: Path | None = None) -> dict:
    g, errors = clean(data)
    if errors:
        raise ValueError(" ".join(errors))
    text = render(g)
    assert yaml.safe_load(text) == g, "the written file must read back as the settings"
    path(folder).write_text(text, encoding="utf-8")
    return g
