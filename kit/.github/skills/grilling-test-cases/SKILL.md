---
name: grilling-test-cases
description: Interviews the author of UAT test cases with numbered questions and recommended answers until every step and expected result is unambiguous, at the strictness level of the run. Use after intake for changed and new cases.
metadata:
  inspired-by: "mattpocock/skills grilling (MIT); github/spec-kit clarify (MIT)"
---

# Grilling test cases

Goal: a stranger could perform every step and check every expected result without guessing.

## 1. Scan

Check every changed or new case in `runs/<run-id>/cases.json` against
`references/ambiguity-checklist.md`, but only the categories the run's level includes
(`strictness` in progress.json; levels in `config/strictness.yaml`). Skip cases whose
`automation` is `manual`: a person performs them, nothing is generated. When a case needs something
the kit cannot do (email, SMS, another system; "Outside the app" in the checklist), recommend
marking it `manual` in the Excel rather than dropping the check.
Before asking, check whether GLOSSARY.md, app-map/app-map.yaml or earlier answers already settle it.
Planner mismatches (`runs/<run-id>/mismatches.md`) are questions too.

## 2. Ask in rounds

- Only questions whose answer changes how the test is performed or judged.
- At most 5 per round (`max_questions_per_round`), most important first.
- Ask what can be asked now; questions that depend on another answer wait for the next round.
- Number each question, give your recommended answer, and word it so "yes" accepts it:

```
Q1. TC-04 step 2 says "enter a valid date". Use 15/11/2026?
    Recommended: yes. Any future date works for this test.
```

## 3. Record at once

After each answer:
1. Append it to `runs/<run-id>/clarifications.md` under the Test ID: `- Q: ... -> A: ...`.
2. Apply it to cases.json: fill the missing value, rewrite the expected result in checkable words.
   Keep the step numbering. Mark the case `"clarified": true`.
3. If a term was explained, use the maintaining-glossary skill.

## 4. Stop when

- Nothing is open, or
- The author says to proceed: mark what is left `OPEN` in clarifications.md and set
  `"open_questions": true` on those cases in cases.json. They are not generated; they are reported as not run.
- The author is not available: use the writing-questionnaires skill and stop that part of the run.
