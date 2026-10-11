# UAT agents

Run user acceptance tests from an Excel file with AI agents and Playwright, in VS Code with GitHub Copilot.
Business users fill in test cases in a fixed Excel template; the agents clarify them, turn them into
Playwright tests, run them in a real browser, and write the results back to Excel for sign-off.

The design decisions referred to by number (`decisions: [n]` in config/features.yaml) are in the UAT Flow
Map / `uat-flow-decisions.md`, a design document kept outside this repository. The latest review of the
kit, with every issue found and its status, is `REVIEW.md`.

## Install once

| What | Why | How |
| --- | --- | --- |
| VS Code with GitHub Copilot | Runs the agents, skills, prompts and the guard hook | Sign in to Copilot in VS Code; trust this folder |
| Node.js 20.12+ | Runs Playwright and its MCP server (`process.loadEnvFile` needs 20.12) | https://nodejs.org |
| Playwright and Chromium | The browser and the test runner | `npm install` then `npx playwright install chromium` |
| Python 3.10+ | The scripts that read Excel, check tests and write results | `pip install -r requirements.txt` |
| Test accounts | Logins named in the Excel's "Login as" column | UAT Studio's Set up (kept by Studio, never in the project); on your own: `<KEY>_USER` and `<KEY>_PASSWORD` environment variables |
| Your app's address | The only site the browser may open | UAT Studio takes it from the Excel; on your own: a `START_PAGE` environment variable, and the same site in `config/guardrails.yaml` |

Then, in Copilot chat: `/setup-uat`. It checks all of the above and asks before installing anything.
If your app has a login: `/setup-login`, once. It asks which kind of login the app has, maps the login
page, writes `tests/login.ts` and proves every test account logs in (you never type a password in chat).

Playwright's three agents in `.github/agents/playwright-test-*.agent.md` and the server in
`.vscode/mcp.json` were created by `npx playwright init-agents --loop=vscode` (Playwright 1.64) and are
unmodified. Run that command again after upgrading Playwright.

## Run

1. Fill in `templates/uat-test-cases.xlsx` (one row per test case; see its "How to fill in" sheet).
   Cases a person must perform (an email arrives, a phone call, another system) get `manual` in the
   Automation column: they are not generated or run, but stay in the results.
2. In Copilot chat: `/run-uat path/to/your-file.xlsx`
3. Answer the clarification questions, confirm changes, and approve or decline repairs when asked.
4. `/sign-off`: record the result of each manual case, then decide PASS, CONCERNS, FAIL or WAIVED per
   group. Closing the sign-off seals the run (every file it rests on is hashed); the results are in
   `runs/<run-id>/results.xlsx`, whose Run sheet says exactly which Excel, site, accounts and tool
   versions were tested.

A stopped run continues with `/resume-uat`. When the same Excel comes back edited, unchanged cases reuse
their tests with no AI; only changed and new cases are clarified and generated again.

To try it on the demo app: start `playwright-demo/sample-app` (`node server.js`, port 4173), then
`/run-uat examples/expense-tracker-tests.xlsx`, and later `/run-uat examples/expense-tracker-tests-v2.xlsx`.

## How a run works

| Stage | Who | What |
| --- | --- | --- |
| preflight | uat-setup + script | Everything installed, start page reachable, login set up |
| intake | scripts | Read and validate the Excel; sort cases into unchanged, changed, new, missing |
| clarify | uat-clarifier + you | Numbered questions until every changed or new case is unambiguous |
| plan | scripts | Prove the run's accounts log in; copy the cases into Playwright's plan layout, one plan per group, one logged-in seed per account |
| planner_check | Playwright planner + script | Check the steps against the live app; save the app map; mismatches go back to clarify |
| generate | Playwright generator | Walk each case live and write one test file per case |
| test_check | scripts | Reject tests that prove nothing, fake the server, or log in wrongly; run new tests 3 times |
| run | script | The saved tests run with no AI, logged in through tests/login.ts; evidence, console and network errors are recorded (each test's trace shows them too) |
| failures | uat-diagnostician + you + Playwright healer | Diagnosis, cause label, reproduction; repairs only with your yes, behind the assertion lock |
| screens | script (+ uat-screen-reviewer) | Compare each step with the last signed-off run |
| signoff | uat-reporter + you | Recommendations from evidence, your decisions, sealed run, results.xlsx |

## How login works

Login is code, not an agent: `tests/login.ts` (written once with `/setup-login`) knows the app's login
steps and what proves a user is logged in. A generated test says `test.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' })`;
the fixture logs in once per account and run, keeps the session in `runs/<run-id>/auth/`, and every test of
that account starts logged in. `check_tests.py` rejects a test whose account differs from the Excel or that
types a password. Supported login shapes, and what to do for MFA, SSO and CAPTCHA, are listed in
`.github/skills/setting-up-login/references/login-patterns.md`.

## Power Apps canvas apps

Canvas apps are tested with the same flow; only the way a test reaches the controls differs. A case whose
start page is `apps.powerapps.com/play/...` gets `app_type: canvas` in the plan. Its group is mapped by the
**uat-canvas-specialist** agent (Playwright's planner only sees the player frame from outside), and its test
imports `tests/canvas-fixtures.ts`:
- controls by their Power Apps Studio name inside the player frame: `canvas.control('SaveButton')`;
- typing that fires Power Fx OnChange (`canvas.type`); `fill()` does not and is refused by the test check;
- clicks through gallery overlays (`canvas.click`), gallery rows by text, `canvas.scrollTo` for rows out of view;
- `canvas.waitReady(...)` after `goto` for Dataverse first loads of up to 60 seconds.

Rules: `.github/skills/testing-canvas-apps/` and `mapping-canvas-apps/`; settings: `config/power-platform.yaml`;
login with Microsoft Entra ID: login-patterns.md pattern 15 (MFA accounts use a session saved by Microsoft's
`playwright-ms-auth`, via an `<ACCOUNT>_STORAGE_STATE` environment variable). `npm run selftest:canvas` checks the helpers in a
real browser against a fake canvas player. The helpers are adapted from Microsoft's official
[power-platform-playwright-samples](https://github.com/microsoft/power-platform-playwright-samples), which
replaces the deprecated Power Apps Test Engine. Not yet tried against a real tenant.

## Layout

```
AGENTS.md, GLOSSARY.md        read by every agent (a short map, and the app's words)
REVIEW.md                     the latest review: issues found, fixed or still open
config/                       the rules, enforced by scripts and the guard hook
templates/                    the Excel template (make_template.py rebuilds it)
examples/                     demo Excel files for the sample app
.github/agents/               9 agents of ours + Playwright's planner, generator, healer
.github/skills/               20 skills: instructions, references and the scripts that do the deterministic work
.github/prompts/              /setup-uat, /setup-login, /run-uat, /resume-uat, /sign-off, /map-canvas-app
.github/hooks/guard.json      runs scripts/guard_hook.py before every tool call
scripts/                      guard hook, test runner, progress file and its Playwright reporter, shared helpers, selftest.py
selftest/                     pytest suite for every script, run on a throw-away copy of the kit (python scripts/selftest.py)
tests/                        fixtures.ts (login, evidence, console capture), canvas.ts + canvas-fixtures.ts, login.ts, seed.spec.ts, seeds/ per account,
                              login.check.spec.ts, generated tests per group, _removed/ (set aside, never run)
specs/, app-map/              generated: Playwright plans and the app map
runs/<run-id>/                everything about one run (not committed); runs/current is Playwright's scratch folder
```

## Status

Tested end to end without AI on the demo app (two runs, October 2026): every script, the Playwright
config, fixture and progress reporter, change detection between runs, the test check (including
"proves nothing" and the assertion lock), flakiness and reproduction runs, console filtering, screen
comparison, evidence check, sign-off and the results Excel, and the guard hook with simulated tool calls.
The AI stages were simulated by writing their outputs by hand.

October 2026 review (`REVIEW.md`): login at run time, the sealed sign-off and Run sheet, the hardened
assertion lock and test rules, the `runs/current` and `tests/_removed/` fixes, the relative-URL and
protected-file rules in the hook, and the planner-report checks were added and verified with the scripts.
Manual cases (Automation column) and the `selftest/` suite (77 tests, every script, no browser needed)
followed; `python scripts/selftest.py` is the check to run after changing any script or config file.

Not yet tested inside VS Code (first real trial):
- The agents' `tools`, `agents` and `model` values, and whether a subagent can ask the user questions
  (`vscode/askQuestions`); fallback: handoffs between agents.
- The exact MCP tool name prefix seen by the guard hook (the stdin field names `tool_name`/`tool_input`
  and the `windows:` command key are now documented by VS Code); read it from the agent debug log.
- Whether blocking `browser_evaluate` and `planner_save_plan` limits the planner, generator or healer.
- Whether the generator follows the extra rules in its message (fixture import, `test.use(loginAs)`,
  `shot(N)`, app-map checks).
- `tests/login.ts` against a real login page (the demo app has none), and `/setup-login` end to end.
- Whether the screen reviewer can read image files with the `read` tool.
- Model names: every agent uses "Claude Sonnet 4.6" (as Playwright's own agents do); the name must match
  Copilot's model picker. Cheaper models for simple jobs are a future feature (F15).

## Credits

Ideas adapted (not copied) from Matt Pocock's skills (grilling, domain-modeling, to-questionnaire; MIT),
GitHub Spec Kit (clarify; MIT), obra/superpowers (verification-before-completion, systematic debugging; MIT),
BMAD TEA (quality gate verdicts), Metabase Repro-Bot (reproduce before reporting), QA.tech (app map),
WebTestPilot (checks only on observed elements), Shopify (flakiness gate), Anthropic's long-running agent
harness article (progress file), Playwright's test agents and authentication guide (storageState per account),
Microsoft's power-platform-playwright-samples (canvas helpers, MIT), and the UAT sign-off practice of binding a decision to a build, an environment and hashed evidence.
