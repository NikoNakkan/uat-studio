# Planner report format

Answer with exactly three sections.

## Mismatches

One line per step you could not perform as written, or `None`: an element, page or field the step names
that is not there. Name the Test ID and step, quote the words from the plan, and say what the page has instead.
Only the test's author can fix these, so they go back to clarification.

- TC-01 step 3: "Save" not found. The page has a button "Add expense".
- TC-04 step 1: the start page http://localhost:4173/reports returned "Not found".

## Results that differ

One line per step you could perform, but where the page then showed something other than the expected
result, or `None`. The test case is the requirement: do not judge which is right. These are suspected app
bugs; the test is still written as the plan says, and the run and the diagnosis settle them.

- TC-42 step 3: expected no "Low" label next to Saline; the page shows "Saline 5 on hand Low".

## App map

A YAML block with every page you visited and every element you used or checked, with its exact
role and visible name as the accessibility snapshot shows them. Add `example_text` for elements
whose text changes (status messages, totals). Say how each page is reached.

```yaml
pages:
  expenses:
    address: http://localhost:4173/
    reached_by: start page
    elements:
      - { role: textbox, name: "Description" }
      - { role: spinbutton, name: "Amount (EUR)" }
      - { role: button, name: "Add expense" }
      - { role: status, name: "", example_text: "Added Taxi" }
      - { role: list, name: "Expenses" }
```
