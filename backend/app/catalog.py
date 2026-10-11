"""Every agent of the flow with the model recommended for its job, and the models a person can choose.

The recommendation is the default: a person's choice is stored only when it differs from it, so a
better recommendation in a later version reaches everyone who never changed that agent.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

OPUS, SONNET, HAIKU, FABLE = "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"


@dataclass(frozen=True)
class ModelInfo:
    name: str
    price: str      # US dollars per million input / output tokens
    use: str


@dataclass(frozen=True)
class AgentInfo:
    job: str
    recommended: str
    why: str


MODELS = {
    FABLE: ModelInfo("Claude Fable 5.1", "$10 / $50", "The most capable model; slower, 2.5 times the price of Opus."),
    OPUS: ModelInfo("Claude Opus 5.5", "$4 / $20", "Hard judgment calls where a mistake costs a person's time."),
    SONNET: ModelInfo("Claude Sonnet 5.5", "$2 / $10", "Everyday agent work: long walks through the live app."),
    HAIKU: ModelInfo("Claude Haiku 5.5", "$0.10 / $0.50", "Short, simple jobs: explaining text, one-line summaries."),
}

# Every agent of the flow, as the kit names them.
AGENTS = {
    "uat-clarifier": AgentInfo(
        "Asks the test author until every case is unambiguous", SONNET,
        "Reads business language and asks clear questions; a few turns per case."),
    "playwright-test-planner": AgentInfo(
        "Playwright's planner: checks steps in the live app, maps pages", SONNET,
        "Long walks through the live app with many browser actions; Sonnet keeps them fast and affordable."),
    "playwright-test-generator": AgentInfo(
        "Playwright's generator: writes one test per case, live", SONNET,
        "The busiest agent (one conversation per case); Sonnet wrote 33 of 34 passing tests in the first full run."),
    "playwright-test-healer": AgentInfo(
        "Playwright's healer: repairs approved tests behind the lock", OPUS,
        "Runs rarely, but must repair a test without hiding a real bug."),
    "uat-diagnostician": AgentInfo(
        "Diagnoses failures, reproduces suspected bugs", OPUS,
        "Decides app bug or broken test; runs only on failures, and a wrong call misleads the sign-off."),
    "uat-console-analyst": AgentInfo(
        "Explains new console and network errors", HAIKU,
        "Short explanations of error text; a small, fast model is enough."),
    "uat-screen-reviewer": AgentInfo(
        "Labels changed screens explained or unexplained", SONNET,
        "Compares screenshots with the change notes; needs good vision and judgment."),
    "uat-reporter": AgentInfo(
        "One line of reasoning per sign-off unit", HAIKU,
        "One line per unit from evidence already checked; no tools."),
    "uat-login-setup": AgentInfo(
        "Writes tests/login.ts once per app", OPUS,
        "Runs once per app and every test depends on it, so the stronger model costs little."),
    "uat-canvas-specialist": AgentInfo(
        "Maps Power Apps canvas apps by control name (planner check for canvas cases)", OPUS,
        "Canvas apps lack normal page structure and are hard to read; worth the stronger model."),
}


def public_catalog() -> dict:
    """The agents and model choices as the browser sees them."""
    return {
        "agents": {a: asdict(info) for a, info in AGENTS.items()},
        "model_choices": [{"id": m, **asdict(info)} for m, info in MODELS.items()],
    }
