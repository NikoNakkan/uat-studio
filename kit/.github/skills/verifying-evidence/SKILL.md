---
name: verifying-evidence
description: Checks a finished run's evidence and computes each case's recommendation before sign-off. Use before recommending any result.
metadata:
  inspired-by: "obra/superpowers verification-before-completion (MIT): evidence before claims"
---

# Verifying evidence

```
python .github/skills/verifying-evidence/scripts/verify_evidence.py runs/<run-id>
```

The script, not you, decides whether evidence exists. A PASS needs all of:
the test passed, the test check found a real check for every expected result, a screenshot for
every step, and a trace. Anything missing makes it CONCERNS, with what is missing.
Failures get their recommendation from the diagnosis (config/signoff.yaml).

Results go to `runs/<run-id>/evidence-check.json`, per test and per sign-off unit.

Manual cases (Automation = manual in the Excel) get the recommendation **MANUAL**: no evidence exists
either way, so the AI never recommends PASS, CONCERNS or FAIL for them, and they do not count in the
unit's recommendation. The person records each manual result at sign-off (writing-results-excel skill).

- Report only the numbers the script printed. Never round "most passed" into PASS.
- You may add one line of reasoning per unit, but never change a recommendation upward.
- Changed screens (screens.json) are shown next to the recommendation as advisory notes; they never
  change it.
