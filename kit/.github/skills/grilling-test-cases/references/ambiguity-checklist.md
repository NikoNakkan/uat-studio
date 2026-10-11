# Ambiguity checklist

Each row says which strictness level first includes it (config/strictness.yaml).

| Level | Category | Ask when... | Example question |
| --- | --- | --- | --- |
| basic | Missing value | A step needs a value that is not given ("enter an amount") | TC-02 step 2: use 12.50? |
| basic | Missing expected result | Nothing says how to judge the case, or a key step has no result | TC-05: what should the page show after step 4? |
| basic | Page does not exist | The start page or a named page cannot be found | TC-07 starts at /reports, which returns "Not found". Is the address right? |
| standard | Vague words | valid, correct, works, looks fine, as expected, properly, quickly | TC-03 "the total is correct": should it show €19.75? |
| standard | Unclear element | "click the button" with several buttons; a name not on the page | TC-01 step 3 "Save": the page has "Add expense". Is that the one? |
| standard | Precondition nobody can set up | "an approved invoice exists" with no way to create one | TC-09 needs an approved invoice. Which one, or should the test create it? |
| standard | Glossary conflict | A word used differently from GLOSSARY.md | TC-06 says "confirmed"; the glossary says "approved". Same thing? |
| standard | Change wording | "increases by", "one more", "goes down" (needs a before value) | TC-08 "total increases by 5": what is the total before step 1? |
| standard | Outside the app | Email, SMS, a third-party site, a downloaded file | TC-10 expects an email. Mark TC-10 "manual" in the Automation column so a person checks it and records the result at sign-off? |
| strict | Exact value | The expected result names no exact text or number | TC-04 "an error appears": exactly which text? |
| strict | Irreversible step | The step deletes, sends, pays or changes shared data | TC-05 deletes an expense. Confirm the test may do this on the UAT system? |

Never ask about how to write the test code. Ask only about what the business expects.
