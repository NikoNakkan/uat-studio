---
name: tracking-usage
description: Records which model ran every stage of a UAT run and how many tokens it used, exact where available and estimated otherwise. Use after every stage an agent did, and at sign-off for the totals.
---

# Tracking usage

After every stage done by an agent (scripts use no tokens):

1. Save what was exchanged with that stage's agent: your message to it and its answer, in
   `runs/<run-id>/exchanges/<stage-id>.md` (for per-case stages, append each case).
2. Record it:
   ```
   python .github/skills/tracking-usage/scripts/usage_report.py --run runs/<run-id> --stage generate --agent playwright-test-generator --sent runs/<run-id>/exchanges/generate.md
   ```
   Pass the answer file with `--received` when it is kept separately.
   If the Copilot debug log shows the stage's token counts, pass `--input-tokens` and `--output-tokens`
   instead; they are recorded as exact.

The model comes from the agent's own file (its `model:` field), so it is always exact. Estimated
tokens are marked "estimated": they count only the text exchanged, not the files and tool results
the agent read, so real usage is higher.

Totals for the run: `usage_report.py --run runs/<run-id> --summary`. They also appear in the Usage
sheet of results.xlsx. Exact monthly totals per model come from GitHub's AI usage report;
compare them once a month.
