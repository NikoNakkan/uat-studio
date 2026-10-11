---
name: writing-playwright-plan
description: Writes clarified UAT test cases as Playwright test plans, one per Group, and lists the cases the generator must write. Use after clarification.
---

# Writing the Playwright plan

A straight copy with no interpretation. Run:

```
python .github/skills/writing-playwright-plan/scripts/excel_to_plan.py runs/<run-id>
```

It writes:
- `specs/<group>.plan.md`: one plan per Group in the layout Playwright's planner and generator read
  (suite heading, seed file, `#### 1.1 TC-01 Title`, steps, expected results).
- `runs/<run-id>/generate-list.json`: the cases to generate (new, regenerate, or no test file yet),
  each with its suite, test name, target test file, seed file and the text for the generator.
  Cases marked `reuse` in changes.json, and cases with open questions, are left out.

Never edit the plan by hand. If a case is wrong, fix cases.json through clarification and run the script again.
