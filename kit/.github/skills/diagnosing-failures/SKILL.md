---
name: diagnosing-failures
description: Explains why a UAT test failed from its error, screenshots, trace and console errors, labels the cause, and records the person's repair decision. Use for every failed test after a run.
metadata:
  inspired-by: "obra/superpowers systematic-debugging (MIT): root cause before any fix"
---

# Diagnosing failures

The failed tests are the cases whose result in `runs/<run-id>/progress.json` is not `passed`.
For each one:

1. **Read the evidence**, in this order. `<ev>` is the test's `evidence` folder in progress.json
   (`evidence`, or `evidence-2` and so on after a re-run):
   - the error in progress.json (`error`) and in `<ev>/results.json`
   - the last step screenshot `<ev>/screenshots/<TestID>-step<N>.png`
   - the failure screenshot and video in `<ev>/test-output/`
   - console and network errors for that test (`evidence/console/<test-id>.json`, also in the trace)
   - the trace, if needed: `npx playwright show-trace <path to trace.zip>`
2. **Write** what was expected, what happened, and why, in three short lines.
3. **Label the cause** using `references/cause-labels.md`: `app_broken`, `test_broken` or `environment`.
4. **Record it**:
   ```
   python .github/skills/diagnosing-failures/scripts/record_diagnosis.py runs/<run-id> TC-03 --cause app_broken --summary "Total shows €12.50 after adding 7.25; the second expense is not counted."
   ```
5. `app_broken`: use the reproducing-failures skill before it goes to sign-off.
6. `test_broken`: ask the person whether the healer may repair it. Record the answer:
   `--repair approved` or `--repair declined`. The orchestrator calls the healer; you do not.
7. `environment`: no repair; it is re-run later and not counted against the app.

Never suggest a repair that changes what the test checks. If the app's wording changed on purpose,
propose an Excel update instead (detecting-test-changes skill, excel-updates.md).
Write a readable copy of all diagnoses to `runs/<run-id>/diagnoses.md`.
