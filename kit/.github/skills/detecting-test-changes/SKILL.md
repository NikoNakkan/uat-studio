---
name: detecting-test-changes
description: Sorts test cases into unchanged, changed, new and missing compared with the last run, and prepares questions for the uncertain ones. Use at intake when the same Excel comes back edited.
---

# Detecting test changes

1. A script sorts, with no AI:
   ```
   python .github/skills/detecting-test-changes/scripts/diff_cases.py runs/<run-id>
   ```
   It finds the previous run itself, compares what the two Excel files said (cases-original.json) by
   Test ID and by the fields that change what a test does (`meaning_fields` in config/excel-template.yaml),
   and writes `changes.json` and `changes.md`. Unchanged cases that already have a test file are marked
   `reuse` automatically: no AI, no questions. Unchanged cases also keep last run's clarified version,
   so earlier answers are neither lost nor asked again.

2. You judge only what the script marked uncertain:
   - **Changed**: wording only, or a change of meaning? The script flags `wording_only_candidate`
     when only case, spacing or punctuation differ; you still say what changed in one line.
   - **New**: does it look like a reworded or duplicate existing case? See `similar_to`.
   - **Missing**: was it removed on purpose?

3. The person confirms every suggestion. Ask with numbered questions and a recommended answer.
   Record each confirmed decision:
   ```
   python .github/skills/detecting-test-changes/scripts/diff_cases.py runs/<run-id> --decide TC-03 regenerate
   ```
   Decisions: `reuse` (keep the existing test), `generate` (a case with no test yet: write its first one),
   `regenerate` (clarify and write its existing test again),
   `remove` (missing case: its test moves to tests/_removed/, kept but never run),
   `keep` (missing case: keep its test as it is).

4. Proposed Excel updates: when a repaired test makes the Excel wording out of date, write the proposal
   in `runs/<run-id>/excel-updates.md` (Test ID, current wording, proposed wording, why). The person
   accepts or rejects it; never edit the Excel.
