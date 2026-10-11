---
name: reproducing-failures
description: Re-runs a failed test up to 3 times in a fresh browser to confirm a suspected app bug before it reaches sign-off. Use for every failure labelled app_broken.
metadata:
  inspired-by: "Metabase Repro-Bot: reproduce before reporting"
---

# Reproducing failures

```
python .github/skills/reproducing-failures/scripts/reproduce.py runs/<run-id> TC-03 --times 3
```

Each try runs in a fresh browser with its own evidence (`runs/<run-id>/repro/TC-03/try1/` ...).
The script stops at the first failure and records the outcome in diagnoses.json:

- **reproduced**: failed again. Goes to sign-off as a suspected bug. If the error differs from the
  first one, say so in the diagnosis.
- **could_not_reproduce**: passed every re-run. Flagged as unreliable; sign-off sees CONCERNS.
- **already_fixed**: only when the person confirms a fix was deployed since the run. Record it with
  `record_diagnosis.py runs/<run-id> TC-03 --reproduction already_fixed`.

A `test_broken` label only counts when the re-runs or the screenshots show the app itself behaves as the Excel expects.
