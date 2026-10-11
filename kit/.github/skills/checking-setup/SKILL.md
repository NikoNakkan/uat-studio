---
name: checking-setup
description: Checks that Node.js, Playwright and its browser, the Python packages, Playwright's agents and MCP server, the guard hook and the test accounts are in place, and that the start pages are reachable. Use on /setup-uat and before every run.
---

# Checking setup

```
python .github/skills/checking-setup/scripts/check_setup.py [--run runs/<run-id>]
```

One line per requirement, for example:

```
OK       Node.js v22.4.0
OK       Playwright 1.64.0
MISSING  Python package pyyaml  -> pip install -r requirements.txt
OK       Playwright agents (planner, generator, healer)
BROKEN   Start page reachable: https://test.app.com (URLError)  -> check the address, VPN or that the app is running
MISSING  .env: MANAGER_TEST_ACCOUNT_PASSWORD  -> fill it in .env (never in the Excel)
```

- The script never prints secret values, and you never open .env.
- Fix commands: `npm install`, `npx playwright install chromium`, `pip install -r requirements.txt`,
  `npx playwright init-agents --loop=vscode` (re-creates Playwright's three agents and the MCP server
  entry; run it again after upgrading Playwright).
- `MISSING tests/login.ts knows how to log in`: the cases name a test account but login was never
  set up for this app. The person runs `/setup-login` once (setting-up-login skill); you do not write login.ts.
- With `--run`, follow with `python .github/skills/setting-up-login/scripts/check_login.py --run runs/<run-id>`
  to prove those accounts log in (one OK/FAIL line per account, secrets replaced by ***).
- WARN items (for example pillow, used only for screen comparison) do not stop a run.
