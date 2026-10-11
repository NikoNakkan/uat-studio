"""Build example Excel files for the Expense Tracker demo app (playwright-demo/sample-app, http://localhost:4173).

  expense-tracker-tests.xlsx     first delivery: 6 cases (TC-06 is deliberately vague, for the clarifier)
  expense-tracker-tests-v2.xlsx  the same file edited later: a reworded case, a changed case,
                                 a removed case and a new near-duplicate, for change detection

Usage: python examples/make_examples.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "templates"))
from make_template import build  # noqa: E402

START = "http://localhost:4173"
ADD_TAXI = '1. Type "Taxi" in Description\n2. Type 12.50 in Amount (EUR)\n3. Click "Add expense"'

V1 = [
    {"test_id": "TC-01", "group": "Expenses", "title": "Add an expense", "start_page": START, "steps": ADD_TAXI,
     "expected_results": '3. The status message shows "Added Taxi"\n3. The total shows "€12.50"\n'
                         '3. The list of expenses shows "Taxi"', "priority": "High"},
    {"test_id": "TC-02", "group": "Expenses", "title": "Total of two expenses", "start_page": START,
     "steps": ADD_TAXI + '\n4. Type "Lunch" in Description\n5. Type 7.25 in Amount (EUR)\n6. Click "Add expense"',
     "expected_results": '6. The total shows "€19.75"', "priority": "High"},
    {"test_id": "TC-03", "group": "Validation", "title": "Reject a negative amount", "start_page": START,
     "steps": '1. Type "Refund" in Description\n2. Type -5 in Amount (EUR)\n3. Click "Add expense"',
     "expected_results": '3. The status message shows "Amount must be greater than zero."\n3. The total shows "€0.00"',
     "priority": "Medium"},
    {"test_id": "TC-04", "group": "Validation", "title": "Description is required", "start_page": START,
     "steps": '1. Type 10 in Amount (EUR)\n2. Click "Add expense"',
     "expected_results": '2. The status message shows "Please enter a description."', "priority": "Medium"},
    {"test_id": "TC-05", "group": "Expenses", "title": "Delete an expense", "start_page": START,
     "steps": ADD_TAXI + '\n4. Click "Delete Taxi" and confirm',
     "expected_results": '4. The status message shows "Deleted Taxi"\n4. The total shows "€0.00"', "priority": "High"},
    {"test_id": "TC-06", "group": "Expenses", "title": "Totals look right", "start_page": START,
     "steps": "1. Add a few expenses\n2. Check the total", "expected_results": "2. The total is correct",
     "priority": "Low", "notes": "Deliberately vague: the clarifier should ask about it."},
]

V2 = [dict(c) for c in V1 if c["test_id"] != "TC-04"]                       # TC-04 removed
V2[0]["steps"] = ADD_TAXI.replace("Click", "click")                         # TC-01: wording only
V2[2]["steps"] = V2[2]["steps"].replace("-5", "0")                          # TC-03: meaning changed
V2.append({"test_id": "TC-07", "group": "Validation", "title": "A description must be filled in",
           "start_page": START, "steps": '1. Type 10 in Amount (EUR)\n2. Click "Add expense"',
           "expected_results": '2. The status message shows "Please enter a description."',
           "priority": "Medium"})                                           # new, near-duplicate of TC-04

if __name__ == "__main__":
    build(ROOT / "examples" / "expense-tracker-tests.xlsx", V1, guide=False)
    build(ROOT / "examples" / "expense-tracker-tests-v2.xlsx", V2, guide=False)
