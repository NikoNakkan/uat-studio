"""Where things are, and the app's own settings (API key, model per agent).

Settings live outside every repository, in ~/.uat-studio/settings.json, so the API key is never
committed. The key is never sent back to the browser; the UI only sees whether one is set.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parents[2]                    # uat-studio/
KIT_DIR = Path(os.environ.get("UAT_KIT_DIR", APP_DIR.parent / "agentic-testing-kit")).resolve()
STATE_DIR = Path(os.environ.get("UAT_STUDIO_HOME", Path.home() / ".uat-studio"))
SETTINGS_FILE = STATE_DIR / "settings.json"
FRONTEND_DIST = APP_DIR / "frontend" / "dist"

# Every agent of the flow, as the kit names them, with the role it plays in the app.
AGENTS = {
    "uat-clarifier": "Asks the test author until every case is unambiguous",
    "playwright-test-planner": "Playwright's planner: checks steps in the live app, maps pages",
    "playwright-test-generator": "Playwright's generator: writes one test per case, live",
    "playwright-test-healer": "Playwright's healer: repairs approved tests behind the lock",
    "uat-diagnostician": "Diagnoses failures, reproduces suspected bugs",
    "uat-console-analyst": "Explains new console and network errors",
    "uat-screen-reviewer": "Labels changed screens explained or unexplained",
    "uat-reporter": "One line of reasoning per sign-off unit",
    "uat-login-setup": "Writes tests/login.ts once per app",
}
DEFAULT_MODEL = "claude-sonnet-5-5"
MODEL_CHOICES = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]


class Settings(BaseModel):
    api_key: str = ""
    models: dict[str, str] = Field(default_factory=dict)          # agent -> model id; missing = default_model
    default_model: str = DEFAULT_MODEL
    max_turns: int = 60                                            # per agent conversation (run limits, F8)
    max_output_tokens: int = 8000
    show_agent_browser: bool = True                                # headed Chromium while the AI works

    def model_for(self, agent: str) -> str:
        return self.models.get(agent) or self.default_model

    def effective_api_key(self) -> str:
        return self.api_key or os.environ.get("ANTHROPIC_API_KEY", "")

    def public(self) -> dict:
        key = self.effective_api_key()
        return {
            "api_key_set": bool(key),
            "api_key_hint": f"…{key[-4:]}" if len(key) > 8 else "",
            "api_key_from_env": bool(not self.api_key and os.environ.get("ANTHROPIC_API_KEY")),
            "models": {a: self.model_for(a) for a in AGENTS},
            "agents": AGENTS,
            "default_model": self.default_model,
            "model_choices": MODEL_CHOICES,
            "max_turns": self.max_turns,
            "max_output_tokens": self.max_output_tokens,
            "show_agent_browser": self.show_agent_browser,
            "kit_dir": str(KIT_DIR),
        }


def load_settings() -> Settings:
    if SETTINGS_FILE.exists():
        try:
            return Settings(**json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001 - a broken file falls back to defaults
            pass
    return Settings()


def save_settings(s: Settings) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(s.model_dump_json(indent=2), encoding="utf-8")
    try:
        os.chmod(SETTINGS_FILE, 0o600)
    except OSError:
        pass
