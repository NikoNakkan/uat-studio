# UAT Studio

An application for the UAT kit (included in `kit/`): upload an Excel of test cases, answer the
AI's questions, watch Playwright test your app, review the evidence and visual changes, and sign off.
Everything the kit does in VS Code + Copilot, the app does with an Anthropic API key or your GitHub Copilot plan.

## How it works

| Part | What it does |
| --- | --- |
| **Back end** (`backend/`, FastAPI) | The orchestrator as code: walks `config/workflow.yaml` stage by stage, honours the feature switches and limits, stops for a person, and resumes from `progress.json`. Every deterministic step runs the kit's own scripts, unchanged. |
| **Agents** | Our agents (clarifier, diagnostician, console analyst, screen reviewer, reporter, login setup) run on Claude with only their own tools. Playwright's planner, generator and healer keep their unmodified instructions and drive the real Playwright test MCP server. |
| **Guard** | Every tool call of every agent goes through the kit's `scripts/guard_hook.py`. "Ask" becomes an Approve button in the app; "deny" goes back to the agent. |
| **Browser** | While the AI works, Chromium opens visibly (switch it off in Settings). Saved test runs are headless. |
| **Front end** (`frontend/`, React 19 + Vite + Tailwind) | Runs, live activity, "Needs you" questions and approvals, evidence, visual regression per test, sign-off, setup, feature switches, knowledge, settings. |

Where things are kept:
- Runs, evidence and results: in the kit, `runs/<run-id>/` (as before).
- API key and model choices: `~/.uat-studio/settings.json`, outside every repository. Never sent to the browser.
- Test account passwords: the kit's `.env`, written from the Setup page, never shown again, never sent to the AI.

## Install once

Requirements: Python 3.11+, Node.js 20.12+.

```
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt      (macOS/Linux: .venv/bin/python)
cd ../frontend
npm install
npm run build
```

The kit itself (`kit/`) also needs `npm install` and `npx playwright install chromium` (the Setup page offers both).

**The kit.** Studio uses `UAT_KIT_DIR` when it is set; else a kit folder next to uat-studio
(`../agentic-testing-kit`), if there is one; else `kit/` in this repository. `kit/` is a clean copy: no `.env`,
no runs, nothing generated for one app. Refresh it after changing the kit with `python tools/sync_kit.py`.

## Start

```
cd backend
.venv\Scripts\python -m app
```

Open http://127.0.0.1:8765. Then:
1. **Settings**: choose who runs the AI: paste an Anthropic API key, or pick GitHub Copilot (a GitHub token or the GitHub CLI's sign-in). Test.
2. **Setup**: fix anything missing, set the start page and allowed sites, add test accounts, and set up login if the app has one.
3. **Runs**: upload your Excel (template on that page) and start.

Use another kit folder with `UAT_KIT_DIR`, another settings folder with `UAT_STUDIO_HOME`, another port with `UAT_STUDIO_PORT`.
The app listens on 127.0.0.1 only: it holds your API key, so it is not meant to be exposed on a network.

Development: `python -m app` for the API and `npm run dev` in `frontend/` (http://localhost:5173, proxies `/api`).

## Pages

| Page | What you do there |
| --- | --- |
| Runs | Upload an Excel, pick the clarification strictness, see every run |
| Run | The 12 stages (start, stop, resume, retry), live activity, Needs you, and tabs: Cases, Changes & questions, Tests (test check, flakiness, code), Results (evidence per test, screenshots, traces, videos), Failures, Console (mark known noise), **Visual regression** (every test's steps next to the last signed-off run: side by side, slider or difference, with the AI reviewer's comments), Sign-off (decisions, waivers, manual cases, seal, results.xlsx), Usage, Files; download the clarified Excel to paste the answers back |
| Setup | Requirements with one-click fixes (after a yes), app under test, test accounts, login setup and check |
| Feature switches | Switch parts on and off; see what else goes off and what works less well first |
| Knowledge | Glossary, app map, rules (config YAML), test files, agents, skills |
| Settings | API key, model per agent, run limits, show the browser, kit self-tests, token use |

## Tests

```
cd backend
.venv\Scripts\python -m pytest          back end (against a throw-away copy of the kit)
.venv\Scripts\python -m ruff check app tests
cd ../frontend && npx tsc --noEmit -p . && npm run build
```

The kit's own self-tests run from the Settings page, or `python scripts/selftest.py` in the kit.

## Not yet verified

- The AI stages have not run with a real API key yet: the clarifier's questions, Playwright's agents
  over MCP with a real model, the diagnostician, the screen reviewer reading images, login setup.
  The agent loop, the guard and the MCP connection were tested without a model.
