---
name: writing-questionnaires
description: Writes open clarification questions into a short questionnaire for a test author who is not in the conversation. Use when the author cannot answer live.
metadata:
  inspired-by: "mattpocock/skills to-questionnaire (MIT)"
---

# Writing a questionnaire

Write `runs/<run-id>/questionnaire.md`:

```
# Questions about your UAT test cases (<Excel file name>)

For: <author, if known>
Why: before these tests can run, a few steps need exact values or names. Reply under each question.

## TC-04 Edit an expense
1. Step 2 says "enter a valid date". Use 15/11/2026?  (recommended: yes)
   Answer:

## Anything else?
Is there anything about these test cases we should know?
   Answer:
```

- Group by Test ID; most important question first in each group.
- Each question names the step, quotes the unclear words, and offers a recommended answer.
- Then set the clarify stage to `waiting_for_person` with a note naming the file, and stop.
  When the answers come back, record them as in the grilling-test-cases skill.
