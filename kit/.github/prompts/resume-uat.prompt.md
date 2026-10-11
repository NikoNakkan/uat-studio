---
name: resume-uat
description: Continue a stopped UAT run from its progress file.
agent: uat-orchestrator
---
Resume the run in ${input:run:runs/<run-id> (empty = the latest run)} from its progress.json.
If no run is given, find it with: python scripts/progress.py latest
