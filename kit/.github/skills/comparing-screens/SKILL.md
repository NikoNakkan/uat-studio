---
name: comparing-screens
description: Compares each step screenshot with the same step in the last signed-off run and, above a threshold, has the AI label each changed screen explained or unexplained. Advisory only. Use before sign-off.
---

# Comparing screens

## 1. Pixel comparison (script, no AI)

```
python .github/skills/comparing-screens/scripts/compare_screens.py runs/<run-id>
```

- Baseline: the newest run whose sign-off is complete (`signoff.json` with `complete: true`).
- Noise is removed first, without AI: same environment, masks for dates and IDs (applied when the
  screenshot is taken), a pixel tolerance and a limit on how many pixels may change (config/screen-compare.yaml).
- Writes `runs/<run-id>/screens.json` and a difference image per changed screen (changed pixels in red).
- Changed screens are shown side by side to the person at sign-off (Screens sheet of results.xlsx).

## 2. AI review (only when the script prints "AI review: needed")

Done by the uat-screen-reviewer agent. For each flagged screen it looks only at three pictures
(last signed-off, this run, difference) and at `runs/<run-id>/changes.md` (the known test case
changes), and writes `runs/<run-id>/screens-review.json`:

```json
{
  "TC-01-step3.png": { "label": "explained", "note": "The status text changed from 'Added Taxi' to 'Taxi added'; TC-01 was reworded in this Excel (changes.md)." },
  "TC-02-step6.png": { "label": "unexplained", "note": "The total moved below the list; no test case change mentions it." }
}
```

Rules: label every flagged screen; never hide one; never change a test result or recommendation;
never read test code, agent reasoning or diagnoses.
