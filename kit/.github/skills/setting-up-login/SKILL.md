---
name: setting-up-login
description: Writes tests/login.ts once per app (how to log in, how to tell login worked) from the login page in the app map and the test cases, asking the person only what neither shows, then proves every test account logs in with a script. Use with /setup-login and when a run's accounts have never been checked.
---

# Setting up login

Login is **code, not an agent at run time**: `tests/login.ts` is written once per app; the `loginAs`
fixture in `tests/fixtures.ts` calls it, saves the browser session per account in
`runs/<run-id>/auth/`, and every test of that account starts logged in. Passwords stay in `.env`.

## 1. Look, read, then ask only what is left (uat-login-setup agent)

Work things out before asking. **Look** at the login page first (step 2 below). **Read** the test cases
(the run's `cases.json`, or the Excel the person gives): the "Login as" column names the accounts, the
start pages say where login starts, and the first expected results after login usually say what a
logged-in user sees (a greeting, the user's name, a menu), which is what `expectLoggedIn` checks.
From the page and the cases decide the login pattern (`references/login-patterns.md`).

**Ask** the person only what neither shows: a one-time code or two-factor step after the password,
a "choose your organisation" screen, or cases that contradict each other. At most 3 questions, each with
a recommended answer and the reason. If nothing is unknown, ask nothing. Never ask about files or whether
account values are filled in: UAT Studio passes that status in (in VS Code, the `*_USER=` names in
`.env.example` list the accounts); a missing value means telling the person where to fill it in, and stopping.

## 2. Map the login page

Ask the orchestrator-style message of the mapping-the-app skill to Playwright's planner, for one
pseudo-case "LOGIN: open the start page and describe the login page", with the format reference.
Save the answer to `runs/<run-id>/planner-report-login.md` (or `runs/setup/` when there is no run)
and run `merge_app_map.py <folder> login`. The app map now has a page `login` with exact element names.

## 3. Write tests/login.ts

Only `login(page, user, password)` and `expectLoggedIn(page)`. Elements by `getByRole`/`getByLabel`
with the names from the app map. `if` is allowed here (banner present or not). Never log values.
Never write a value from `.env` into the file. Patterns the kit does not support: say so and stop.

## 4. Prove it

```
python .github/skills/setting-up-login/scripts/check_login.py --all
```

One line per account: `OK` or `FAIL` with the first error (secrets replaced by `***`). On FAIL,
fix login.ts from the error and the app map, at most 2 more times, then report to the person.
Before a run, `check_setup.py --run` tells whether login.ts is written; the preflight stage runs
`check_login.py --run runs/<run-id>` for the accounts that run uses.
