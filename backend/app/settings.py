"""Where things are, and the app's own settings (AI provider, API key, model per agent).

Settings live outside every repository, in ~/.uat-studio/settings.json, so the API key is never
committed. The key is never sent back to the browser; the UI only sees whether one is set.
"""
from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .catalog import AGENTS, MODELS, SONNET, public_catalog

APP_DIR = Path(__file__).resolve().parents[2]                    # uat-studio/
KIT_DIR = Path(os.environ.get("UAT_KIT_DIR", APP_DIR.parent / "agentic-testing-kit")).resolve()
STATE_DIR = Path(os.environ.get("UAT_STUDIO_HOME", Path.home() / ".uat-studio"))
SETTINGS_FILE = STATE_DIR / "settings.json"
FRONTEND_DIST = APP_DIR / "frontend" / "dist"

DEFAULT_MODEL = SONNET                                             # agents outside the catalog, the key test


class Settings(BaseModel):
    provider: Literal["anthropic", "copilot"] = "anthropic"       # who runs the agents: an API key, or a Copilot plan
    api_key: str = ""
    github_token: str = ""                                         # for Copilot; else the GitHub CLI sign-in
    models: dict[str, str] = Field(default_factory=dict)          # agent -> model id, only where not the recommended one
    default_model: str = DEFAULT_MODEL
    max_turns: int = 60                                            # per agent conversation (run limits, F8)
    max_output_tokens: int = 8000
    show_agent_browser: bool = True                                # headed Chromium while the AI works

    def model_for(self, agent: str) -> str:
        """The person's choice when it is still offered, else the model recommended for that agent."""
        chosen = self.models.get(agent, "")
        if chosen in MODELS:
            return chosen
        return AGENTS[agent].recommended if agent in AGENTS else self.default_model

    def choose_models(self, chosen: dict[str, str]) -> None:
        """Keep only real choices: known agents, offered models, and different from the recommendation."""
        self.models = {a: m for a, m in chosen.items() if a in AGENTS and m in MODELS and m != AGENTS[a].recommended}

    def effective_api_key(self) -> str:
        return self.api_key or os.environ.get("ANTHROPIC_API_KEY", "")

    def effective_github_token(self) -> str:
        return self.github_token or os.environ.get("COPILOT_GITHUB_TOKEN", "")

    def public(self) -> dict:
        key = self.effective_api_key()
        token = self.effective_github_token()
        return {
            "provider": self.provider,
            "ai_ready": self.provider == "copilot" or bool(key),      # Copilot readiness is checked live (sign-in)
            "api_key_set": bool(key),
            "github_token_set": bool(token),
            "github_token_hint": f"…{token[-4:]}" if len(token) > 8 else "",
            "github_token_from_env": bool(not self.github_token and os.environ.get("COPILOT_GITHUB_TOKEN")),
            "api_key_hint": f"…{key[-4:]}" if len(key) > 8 else "",
            "api_key_from_env": bool(not self.api_key and os.environ.get("ANTHROPIC_API_KEY")),
            "models": {a: self.model_for(a) for a in AGENTS},
            **public_catalog(),
            "default_model": self.default_model,
            "max_turns": self.max_turns,
            "max_output_tokens": self.max_output_tokens,
            "show_agent_browser": self.show_agent_browser,
            "kit_dir": str(_project_dir()),
        }


def _project_dir() -> Path:
    from .projects import current_dir  # noqa: PLC0415 - projects imports this module, so not at the top
    return current_dir()


def load_settings() -> Settings:
    if SETTINGS_FILE.exists():
        try:
            return Settings(**json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return Settings()


def save_settings(s: Settings) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(s.model_dump_json(indent=2), encoding="utf-8")
    with contextlib.suppress(OSError):     # owner-only where the file system supports it
        SETTINGS_FILE.chmod(0o600)
