---
name: run-uat
description: Start a UAT run from an Excel file of test cases.
argument-hint: path to the .xlsx file
agent: uat-orchestrator
---
Start a new UAT run for ${input:excel:path to the Excel file}.
Clarification strictness: ${input:strictness:basic, standard or strict (default standard)}.
