---
name: reading-uat-excel
description: Reads a UAT Excel file in the agreed template into cases.json and validates it. Use when a run starts from an .xlsx file.
---

# Reading the UAT Excel

Run the scripts; never read or interpret the workbook by hand.

```
python .github/skills/reading-uat-excel/scripts/read_excel.py runs/<run-id>/input.xlsx runs/<run-id>/cases.json
python .github/skills/reading-uat-excel/scripts/validate.py runs/<run-id>/cases.json
```

- `progress.py new` already copied the Excel to `runs/<run-id>/input.xlsx`.
- The column rules are in `config/excel-template.yaml`. A case whose Automation column says `manual` is
  performed by a person: it is validated here like any other, then skipped by every later stage until
  sign-off, where the person records its result (validate.py prints how many there are).
- If either script exits with 1, show its problems to the person exactly as printed
  (each names the Excel row and column) and stop. Never edit the Excel or cases.json to make it pass.
- Report only the counts the scripts printed.
