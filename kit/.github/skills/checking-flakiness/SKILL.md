---
name: checking-flakiness
description: Runs new, regenerated or repaired Playwright tests several times in a row and reports any that pass only sometimes. Use after the test check accepts them.
---

# Checking flakiness

```
python .github/skills/checking-flakiness/scripts/repeat_new_tests.py runs/<run-id> --times 3
```

Uses `npx playwright test <files> --repeat-each=3` through scripts/run_tests.py, with evidence in
`runs/<run-id>/flakiness/` and results in `runs/<run-id>/flakiness.json`:

- **stable**: passed every time. Trusted.
- **unreliable**: passed only sometimes. Back to the generator with the evidence of the failing runs
  (screenshots and trace in the flakiness folder). Usual causes: waiting for something that is not
  ready, data left over from an earlier run, a value that changes (date, ID).
- **failing**: never passed. Back to the generator; if it fails again, report it to the person.

A test that is not stable never enters the run as trusted.
