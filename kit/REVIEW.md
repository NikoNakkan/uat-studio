# Review of the UAT kit — October 2026

Every file in the repository was read, the suspected defects were reproduced by running the scripts,
and the fixes below were verified the same way (a throwaway run from `examples/expense-tracker-tests.xlsx`,
the test checker against hand-written good and tampered tests, the guard hook with simulated tool
calls, the sign-off seal, and `npx playwright test --list` for the TypeScript side). The AI stages
themselves (planner, generator, healer, our agents) still need their first real trial in VS Code.

Status words: **Fixed** (code changed and verified), **Partly** (the cheap part is done, the rest is
listed), **Open** (not done; a recommendation).

---

## 1. Defects in what was built

### 1.1 Generated tests never logged in at run time — Fixed

**What was wrong.** The login steps lived in the body of `tests/seed.spec.ts`. Playwright's agents run
the seed once, to *set up the page* while planning and generating; the generated tests only copy its
*shape* (imports, fixtures), not its body. So in the `run` stage every test began at the start page,
logged out. On top of that, the seed read `UAT_LOGIN_AS`, which nothing in the kit ever set. The demo
app has no login, which is why two end-to-end trials did not notice.

**Why it matters.** The kit could not test any real application with a login.

**Fix.**
- `tests/login.ts` is now the one place that knows how to log in (`login()`) and how to tell it worked
  (`expectLoggedIn()`). It is written once per app with the new `/setup-login` command (section 3).
- `tests/fixtures.ts` has a `loginAs` option. A test says `test.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' })`;
  the fixture logs in once per account and run (Playwright's `storageState`), keeps the session in
  `runs/<run-id>/auth/<account>.json`, and reuses it for every test of that account. Sessions older than
  `UAT_SESSION_MAX_AGE_MIN` (default 30) are renewed. Passwords never leave `process.env`.
- `excel_to_plan.py` writes one seed per account in `tests/seeds/`, already logged in, and puts the exact
  `test.use(...)` line into `generate-list.json` and the generator's message.
- `check_tests.py` has a new rule `login_matches_excel`: the account in the test must be exactly the
  Excel's "Login as" account (and absent when the Excel names none), and no password or `_PASSWORD`
  may appear in a test.
- `check_login.py` (new) proves each account logs in and prints `OK`/`FAIL` with secrets replaced by
  `***`. The `plan` stage runs it for the run's accounts before anything is generated; `check_setup.py`
  reports whether `login.ts` has been written.

### 1.2 `/resume-uat` could pick the wrong run — Fixed

**What was wrong.** When Playwright's generator or healer ran a test through the MCP server, the
progress reporter had no `UAT_RUN_DIR` and wrote to `runs/current/progress.json`. `progress.py latest`
sorted folder names, and `current` sorts after every `2026-…` date, so an empty `/resume-uat` resumed
the scratch folder.

**Fix.** The reporter writes nothing unless `UAT_RUN_DIR` is set (only `run_tests.py` sets it).
`progress.py latest` and `show` only accept folders created by `progress.py new` (they have a `run_id`).
`runs/current` is documented as Playwright's scratch folder.

### 1.3 The assertion lock could be bypassed without touching an `expect` — Fixed

**What was wrong.** The lock compared the text of `expect(...)` lines before and after a repair. Two
ways to defeat it were verified:
- redefine the locator variable: `const total = page.getByRole('status')` → `const total = page.getByText('€12.50')`
  leaves `expect(total).toHaveText('€12.50')` byte-identical and trivially true;
- wrap the check: `try { expect(...) } catch {}` keeps the text and removes the effect.

**Fix.** The lock now compares checks with their locator variables *resolved*, so a changed definition is
a changed check. `try`, `catch`, `.catch(` and `if (` are forbidden in tests (UAT tests are straight
lines). Verified: both bypasses are rejected with a clear message.

### 1.4 Test code could fake the app or leave the site — Fixed

**What was wrong.** Nothing stopped a generated or repaired test from mocking the server (`page.route`),
running code in the page (`evaluate`, `addInitScript`), calling the API behind the UI's back
(`page.request`) or navigating to another site. The guard hook only sees MCP tool calls, not the test
code that runs later. Your own "network replay" idea was set aside for exactly this reason, but the rule
was not enforced.

**Fix.** `config/test-check-rules.yaml` forbids `route(`, `unroute(`, `evaluate(`, `evaluateHandle(`,
`$eval(`, `addInitScript(`, `setContent(`, `page.request`, `context.request`, `setExtraHTTPHeaders(`.
A new rule `goto_only_allowed_origins` rejects any `goto()` to a site outside `config/guardrails.yaml`.
Forbidden words are matched in code only, not in the `// N. step` comments, so an Excel step saying
"if the dialog appears" does not trip the rule.

### 1.5 `features.py page` crashed — Fixed

**What was wrong.** It read `scripts/feature_page.html`, which did not exist (`FileNotFoundError`).

**Fix.** The template exists now: an interactive page that applies the same dependency rules as the
script (switching a part off switches off what needs it; core parts cannot be switched off) and shows
the `config/profile.yaml` text to paste.

### 1.6 An apostrophe broke the quoted-value rule — Fixed

**What was wrong.** The regex treated `'` as a quote, so `The user's name shows "Maria"` yielded
`s name shows ` as the "quoted value" and the test was wrongly rejected.

**Fix.** Single quotes count only when they are not inside a word; double quotes of any kind still count.
Verified: `["Maria"]` and `'Added Taxi'` → `["Added Taxi"]`.

### 1.7 The guard hook denied relative addresses — Fixed

**What was wrong.** `browser_navigate` with `/reports` produced the origin `://`, never in the allowed
list, so the planner could not move around the site.

**Fix.** A relative address stays on the site the page is already on and is allowed. Also: words in
`ask_before_click_matching` are matched as whole words ("Delete Taxi" asks, "Undeleted" does not).

### 1.8 Tests set aside in `tests/_removed/` still counted — Fixed

**What was wrong.** Every `tests/**/<id>-*.spec.ts` glob matched `_removed/` too. A case removed in
run 2 and re-added in run 3 was seen as "has a test" → reuse → Playwright ignored the file → silently
"not run".

**Fix.** One helper (`scripts/common.py: test_files_of`) excludes `_removed` everywhere (change detection,
plan, test check, run). `run_tests.py` refuses such a file; `check_tests.py` rejects it.

### 1.9 References to a document that is not in the repository — Fixed (wording)

**What was wrong.** README and `features.yaml` pointed to `uat-flow-decisions.md` and a "UAT Flow Map";
neither is in the repo, so every `decisions: [n]` number was unresolvable for a reader.

**Fix.** Both now say that the design document is kept outside the repository and is not needed to run the
kit. (Adding the document itself is your call.)

### Withdrawn
A suspected mismatch between the key `features.py` writes and reads in `profile.yaml` was a misreading;
the round-trip was tested on a copy and is correct.

---

## 2. Gaps in the design

### 2.1 The sign-off did not say what was tested — Fixed

**What was missing.** A UAT sign-off is only evidence when it is bound to a version: which Excel (exactly),
which site, which accounts, which tool versions, when. `progress.json` stored only the Excel's file name;
`results.xlsx` had no such sheet.

**Fix.** `progress.py new` records the Excel's SHA-256 and the Playwright, Node and kit (git) versions.
`results.xlsx` has a first sheet **Run** with run id, date, Excel name and hash, sites and accounts
tested, strictness, versions, results and the seal.

### 2.2 Sign-off files could be edited afterwards — Fixed

**What was missing.** `signoff.json`, `diagnoses.json`, the evidence and the tests were plain files; a
result could be changed after the decision.

**Fix.** `record_decision.py --complete` seals the run: it hashes every file the decisions rest on
(input Excel, cases, progress, test check, diagnoses, evidence check, console, screens, flakiness,
sign-off, all screenshots/traces/videos, the test files) into `manifest.json`. No further decision can be
recorded. `write_results.py` refuses to write results when any sealed file changed since, naming the files.
Verified by altering a screenshot after the seal.

### 2.3 The healer ran the whole suite and polluted the shared system — Partly

**What was wrong.** Playwright's healer instructions say "run all tests". Together with the flakiness
runs (3×) and reproduction runs, the kit itself changes the UAT system's data before the real run.

**Done.** The orchestrator's message to the healer now says to run only the named file. **Open:** test data
isolation (F1) — prefixed records, cleanup in fixture teardown, a sweep for stale records. Until then,
the order "flakiness runs, then the real run" can still break cases that assume a fresh state (TC-02's
`€19.75` on the demo app).

### 2.4 The planner's report was trusted as written — Fixed

**What was wrong.** The planner reads web pages; its answer becomes app-map entries and *questions to the
author*. A page containing text like "Ignore previous instructions…" could end up as a mismatch line or
an app-map page on another site.

**Fix.** `merge_app_map.py` keeps only mismatch lines that name a Test ID of the run, refuses pages whose
address is not an allowed site, caps elements per page, truncates long strings and refuses a report over
200,000 characters. The planner and generator messages wrap the plan in `<plan>` tags and state that page
text is data. Verified with an injected line and an off-site page.

### 2.5 The hook could not stop an agent from opening `.env` — Fixed

**Fix.** `config/guardrails.yaml` has `protected_files: [.env]`. The hook denies any non-browser tool call
whose input names that file (file tools or a terminal command such as `type .env`); `.env.example` is
still allowed. Verified.

### 2.6 Loops without a cap — Partly

**Done.** `max_planner_rounds: 2` in `config/workflow.yaml`; the orchestrator counts both limits and goes on
without the case when a limit is reached. **Open:** F8 (time and cost limits per run) — the orchestrator
counts by hand until a script keeps the count.

### 2.7 Node version — Fixed

`process.loadEnvFile` needs Node 20.12; `check_setup.py` now checks the minor version. Slow UAT systems:
`UAT_TEST_TIMEOUT_MS` and `UAT_EXPECT_TIMEOUT_MS` in `.env` raise Playwright's timeouts.

### 2.8 Manual cases vanished — Fixed

**What was wrong.** Every real UAT sheet has cases nobody can automate (an email arrives, a phone call, a
printed document, another system). The kit had no word for them: they were clarified, planned, had no
test, and ended as "not run / CONCERNS" in the results.

**Fix.** The template has an `Automation` column (`auto` or empty / `manual`, a drop-down; files without
the column still read, every case counting as auto). A manual case is validated like any other, but is
skipped by clarification, change decisions, the plan, the test check and the run (`is_manual()` in
`scripts/common.py`). `verify_evidence.py` gives it the recommendation **MANUAL** and keeps it out of the
group's worst-of; the person records its result with `record_decision.py --manual TC-09 --result PASS|FAIL|NOT_RUN
--by ... [--note] [--evidence]`, and `--complete` refuses while a manual case has no result. `results.xlsx`
shows the manual result, who recorded it and where the proof is (Tests sheet), a Manual column per group
(Summary) and the manual count (Run sheet). Rules in `config/signoff.yaml` (`manual_cases`); switch
`manual-cases` in the feature map.

### 2.9 No automated tests for the scripts — Fixed

**What was wrong.** About twenty Python scripts carry the deterministic work, and 1.2–1.8 were exactly the
kind of regressions a small test suite catches. Nothing ran them except the hand-made end-to-end trial.

**Fix.** `selftest/` is a pytest suite (77 tests). Each test copies the kit into a temporary folder and
runs the scripts there with subprocess, as an agent would; the repository is never touched and no browser,
Node.js or app is needed. It covers the feature switches and profile, run folders and `runs/current`,
Excel reading and validation (including the Automation column and old files without it), plan and seed
writing, change detection and decisions, the test check (every rule, the assertion lock and its bypasses,
`tests/_removed/`), the guard hook, `run_tests.py` refusals, the planner-report merge, evidence
recommendations and diagnoses, decisions, manual results, the seal, `results.xlsx` content and the
tamper refusal, and that `check_login.py` and `check_setup.py` never print a secret. Run it with
`python scripts/selftest.py` (pytest is in `requirements.txt`).

### 2.10 Still open (recommendations, not done)

| # | Gap | Why it matters | Suggested shape |
| --- | --- | --- | --- |
| b | Clarifications never reach the Excel | The clarifier rewrites `cases.json`; the author's Excel keeps the vague wording; one edit to a clarified case loses every earlier answer | The clarifier proposes Excel updates (`excel-updates.md`) and the reporter hands them back as a ready-to-paste sheet |
| c | Multi-role cases | "Employee submits, manager approves" cannot be expressed; `login_as` is single-valued | A step prefix `[as Manager test account]`, a second `loginAs` per step block via a `switchAccount(...)` fixture |
| d | Case dependencies and order | Preconditions are free text; execution order is alphabetical by path | A `Depends on` column; `run_tests.py` orders by it and skips dependents when a prerequisite failed |
| e | Data-driven cases | Same steps, several data rows | A `Data` sheet keyed by Test ID; one generated test per row |
| f | Multiple tabs / popups | The fixture captures console and screenshots of the primary page only | Listen on `context` for new pages; attach them to the same test |
| g | Excel number cells | `data_only=True` turns `12.50` into `12.5` in a single-value cell | Read with `number_format` and format back |
| h | Planted-bug check (F10) | The self-tests prove the scripts; F10 would prove the whole flow catches a deliberately broken app | A golden Excel against the demo app with planted bugs, run end to end |
| i | Usage tracking is hand-estimated | The orchestrator saves exchanges by hand at 4 chars/token; it will be skipped or wrong | Mark it "indicative" in results, or drop until Copilot exposes real counts |
| j | Evidence is paths, not pictures | Approvers do not open traces | Record video for every test (switch), embed step screenshots in the Screens sheet or an HTML evidence pack |
| k | Requirement traceability | The first thing an auditor asks for | Optional `Requirement` column → a column in the Tests sheet |
| l | Flaky quarantine (F12) | A known-unreliable test blocks a whole group's PASS | Status `unstable`: keeps running, shown in results, never blocks |
| m | Changed-since-last-run column | Regressions should jump out for the approver | pass→fail / fail→pass per case against the last signed-off run |

---

## 3. Do we need a login agent?

Short answer: **not at run time, and not one that generates UI.** Here is the reasoning and what was built.

**Why login must be code, not an agent, at run time.**
- Rule 6 says passwords never reach the AI. An agent that logs in each run would have to see them, or at
  least type them, and its chat and trace would carry them.
- Login runs for every test of every run. An AI step there costs tokens, time and reliability for a task
  that is identical every time. The `run` stage is "no AI" by design (decision 18).
- MFA, SSO and CAPTCHA are not solved by being clever in the moment; they are solved by preparing the test
  accounts and environment (patterns 7–12 in the reference).

**What does need a person and, once, an agent.** Three things are per app and were missing a home:
1. *Which account a case uses* — already in the Excel ("Login as"), now enforced in the test by `check_tests.py`.
2. *The credentials* — already in `.env`, now unreadable by agents (hook).
3. *The app's login steps and what proves a user is logged in* — this was the gap: it required a developer to
   edit `seed.spec.ts`, and even then it did not reach the generated tests.

For (3) there is now a **one-time login setup agent**, `uat-login-setup` (`/setup-login`), with the
skill `setting-up-login`. It asks the responsible person which login pattern the app has and what is on
screen only after login; it has Playwright's planner map the login page into the app map (exact element
names); it writes `tests/login.ts` from the app map and the answers; and it proves every account logs in
with `check_login.py`, which prints `OK`/`FAIL` per account and replaces any `.env` value in the output
with `***`. It never sees a password, and it writes exactly one file. After that, every run logs in through
code: the `loginAs` fixture, the per-account seeds, the login check at the start of the `plan` stage.

**About a "UI component generator" agent.** The kit tests an app; it does not build one. What the login
agent needs to know is *what kinds of login UI exist and how each is handled*. That list is now
`.github/skills/setting-up-login/references/login-patterns.md`: 14 patterns (user name + password, two-step,
login behind a button, tenant/role picker, cookie banner, remember-device, forced password change, TOTP,
SMS/email codes, magic link, SSO/OAuth, CAPTCHA, session expiry, no login) with, for each, whether the kit
supports it today and what the person must do otherwise (for SSO: capture a session by hand once with
`npx playwright codegen --save-storage` and drop it in `runs/<run-id>/auth/`). When your app arrives, the
setup agent walks that table with the responsible person; new patterns are added to the table, not to
agent prose. The elements of the login page themselves are recorded where every other element is: the app
map, under a page named `login`.

**Where the per-case "what type of user" lives.** In the Excel, one account per case, as before. Cases
that need two roles in one flow are gap (c) above and are the next thing to design for the login story.

---

## 4. Files changed or added in this review

Added: `tests/login.ts`, `tests/login.check.spec.ts`, `scripts/common.py`, `scripts/feature_page.html`,
`.github/skills/setting-up-login/` (SKILL.md, `references/login-patterns.md`, `scripts/check_login.py`),
`.github/agents/uat-login-setup.agent.md`, `.github/prompts/setup-login.prompt.md`, `REVIEW.md`.

Changed: `tests/fixtures.ts`, `tests/seed.spec.ts`, `playwright.config.ts`, `scripts/progress-reporter.ts`,
`scripts/progress.py`, `scripts/run_tests.py`, `scripts/guard_hook.py`, `config/guardrails.yaml`,
`config/test-check-rules.yaml`, `config/workflow.yaml`, `config/features.yaml`, `.env.example`,
`AGENTS.md`, `README.md`, `.github/agents/uat-orchestrator.agent.md`, `.github/agents/uat-reporter.agent.md`,
and the scripts/SKILL.md of `checking-generated-tests`, `checking-setup`, `detecting-test-changes`,
`mapping-the-app`, `reading-uat-excel` (validate), `writing-playwright-plan`, `writing-results-excel`.

Added afterwards (2.8, 2.9): `selftest/` (conftest and nine test files), `scripts/selftest.py`; `pytest` in
`requirements.txt`. Changed for manual cases: `config/excel-template.yaml` (Automation column),
`config/signoff.yaml` (`manual_cases`), `templates/make_template.py` and the rebuilt
`templates/uat-test-cases.xlsx`, `scripts/common.py` (`is_manual`), `scripts/run_tests.py`,
`validate.py`, `diff_cases.py`, `excel_to_plan.py`, `check_tests.py`, `verify_evidence.py`,
`record_decision.py` (`--manual`), `write_results.py`, the SKILL.md of `grilling-test-cases` (and its
checklist), `verifying-evidence`, `writing-results-excel`, `.github/agents/uat-reporter.agent.md`,
`config/features.yaml` (`manual-cases`, `self-tests`), `README.md`.

Not changed: Playwright's three agent files (unmodified by design), GLOSSARY.md.
