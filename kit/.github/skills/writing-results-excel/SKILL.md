---
name: writing-results-excel
description: Records the person's sign-off decisions and waivers, and writes the results Excel of a UAT run with recommendations, decisions, changed screens and usage. Use at sign-off.
---

# Writing the results Excel

## Record each decision

For every sign-off unit (config/signoff.yaml: group by default), show the AI recommendation from
evidence-check.json with its one-line reasoning, ask the person, and record the answer:

```
python .github/skills/writing-results-excel/scripts/record_decision.py runs/<run-id> --unit Expenses --decision PASS --by "Maria K."
python .github/skills/writing-results-excel/scripts/record_decision.py runs/<run-id> --unit Validation --decision WAIVED --by "Maria K." --reason "Known issue JIRA-123, fix in release 2.4"
```

A waiver needs who and why.

**Manual cases** (recommendation MANUAL in evidence-check.json): ask the person who performed each one
for its result and where the proof is, and record it:

```
python .github/skills/writing-results-excel/scripts/record_decision.py runs/<run-id> --manual TC-09 --result PASS --by "Maria K." --note "Email arrived in 2 min" --evidence "shared/uat/TC-09-email.png"
```

Results: PASS, FAIL or NOT_RUN. The sign-off cannot close while a manual case has no result.

When every unit has a decision and every manual case a result, close the sign-off:
`record_decision.py runs/<run-id> --complete`. This seals the run: every file the decisions rest on
(input Excel, cases, results, test check, diagnoses, evidence, the test files) is hashed into
`manifest.json`, no further decision can be recorded, and the run becomes the baseline for screen
comparison. New results need a new run.

## Write the file

```
python .github/skills/writing-results-excel/scripts/write_results.py runs/<run-id>
```

It refuses (exit 1) when a sealed file changed since `--complete`; report the lines it printed.
Sheets: **Run** (run id, date, Excel file and its SHA-256, sites and accounts tested, Playwright,
Node and kit versions, seal), **Summary** (per unit), **Tests** (per case, with its Excel row,
result, recommendation, what is missing, cause, reproduction, repair, evidence folder), **Waivers**,
**Screens** (changed screens and the AI's labels), **Usage** (model and tokens per stage).

Repeat the counts the script printed. Never type numbers yourself.
