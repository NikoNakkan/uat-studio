---
name: checking-generated-tests
description: Checks generated and repaired Playwright tests before they are trusted, including the "proves nothing" rule and the assertion lock after repairs. Use after the generator or the healer writes a test.
---

# Checking generated tests

Run the script; never judge a test file yourself.

```
python .github/skills/checking-generated-tests/scripts/check_tests.py runs/<run-id>
```

It checks every case's test file against `config/test-check-rules.yaml`:
- imports `test` from tests/fixtures.ts, the title starts with the Test ID, at least one check
- **login**: `test.use({ loginAs: '<KEY>' })` matches the Excel's "Login as" account (and is absent
  when the Excel names none); no password or `_PASSWORD` in the test
- every `goto()` stays on the allowed sites (config/guardrails.yaml)
- a `// N. <Excel text>` comment for every Excel step, and `await shot(N)` in each step's block
- no skip, fixme, only, fixed waits or networkidle; nothing that fakes the app or the server
  (`route(`, `evaluate(`, `addInitScript(`, `page.request` ...); no `if`, `try/catch` (a check inside
  them can stop counting without changing its text)
- **proves nothing**: checks that are always true are rejected (page title, the element just
  clicked is visible, "the list exists")
- every expected result `N. ...` has a real check in step N's block, on an element recorded in
  app-map/app-map.yaml, containing the quoted values and amounts from the Excel
- tests in `tests/_removed/` are never checked, counted or run

Results go to `runs/<run-id>/test-check.json` (the evidence check reads it later).

**Rejected after generation**: send the case back to the generator with the script's reasons,
at most `max_generate_attempts` times (config/workflow.yaml), then report it to the person.

**Repairs (assertion lock)**: before the healer touches a test, keep a copy; afterwards, check it:
```
python .github/skills/checking-generated-tests/scripts/check_tests.py runs/<run-id> --snapshot TC-07
python .github/skills/checking-generated-tests/scripts/check_tests.py runs/<run-id> --files tests/expenses/TC-07-delete-an-expense.spec.ts --assertion-lock
```
A repair that adds, removes or changes any `expect(...)`, or redefines a locator variable an
`expect` uses (`const total = ...`), is rejected: put the copy back with
`check_tests.py runs/<run-id> --restore TC-07` and report it as a finding. A skip, fixme, `if`,
`try/catch` or `route()` added by the healer is rejected and reported the same way.
